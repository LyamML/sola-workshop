// =============================================================================
//  Sola — Bracelet résident (prototype)
//  ESP32 + KY-039 (LED IR + phototransistor, sortie analogique)
//
//  Mesure : fréquence cardiaque, intervalles RR, RMSSD (variabilité cardiaque)
//  Liaison : BLE vers la borne de cabine — profils standard du Bluetooth SIG
//              · Heart Rate Service  0x180D  (FC + intervalles RR + contact)
//              · Battery Service     0x180F  (niveau de batterie)
//              · service Sola (custom)      (RMSSD, qualité, amplitude)
//            + copie JSON sur le port série (secours de démonstration)
//
//  Câblage
//    KY-039  "-"      -> GND
//    KY-039  milieu   -> 3V3      (SURTOUT PAS 5V : l'ADC ne tolère que 3,3 V)
//    KY-039  "S"      -> GPIO34   (ADC1 — garde ADC1 même sans Wi-Fi)
//
//  Le doigt se place entre la LED et le phototransistor, immobile et sans
//  écraser. Le capteur est sensible à la lumière ambiante : masque-le.
//
//  ATTENTION : nécessite un ESP32 avec Bluetooth (ESP32 classique, S3, C3).
//  L'ESP32-S2 n'a PAS de radio Bluetooth — sur cette puce, reviens au Wi-Fi.
// =============================================================================

#include <Arduino.h>
#include <NimBLEDevice.h>

static const char* DEVICE_NAME = "SOLA-BR-0448";
static const char* RESIDENT_ID = "R-0448";

// Services standard du Bluetooth SIG
static const char* UUID_HRS      = "180D";   // Heart Rate Service
static const char* UUID_HRM      = "2A37";   // Heart Rate Measurement
static const char* UUID_BAS      = "180F";   // Battery Service
static const char* UUID_BAT_LVL  = "2A19";   // Battery Level

// Service propre à Sola : ce que le standard ne transporte pas
static const char* UUID_SOLA_SVC    = "7a0b1000-5e4d-4b7a-9c3f-1e2d3c4b5a60";
static const char* UUID_SOLA_STATUS = "7a0b1001-5e4d-4b7a-9c3f-1e2d3c4b5a60";

// ---------------------------------------------------------------- acquisition
static const int PIN_PPG   = 34;        // ADC1_CH6, broche en entrée seule
static const int FS        = 500;       // Hz — 2 ms de résolution sur les RR
static const int PERIOD_US = 1000000 / FS;

// ------------------------------------------------------------------- filtrage
// La ligne de base suit la dérive lente (respiration, pression du doigt,
// lumière ambiante) ; on la soustrait pour ne garder que la pulsation.
static const float A_BASE   = 0.002f;   // passe-bas très lent  (~0,15 Hz)
static const float A_SMOOTH = 0.18f;    // passe-bas de lissage (~15 Hz)

// ------------------------------------------------------------- détection RR
static const uint32_t REFRACT_MS = 300; // 300 ms => 200 bpm maximum
static const uint32_t RR_MIN_MS  = 300;
static const uint32_t RR_MAX_MS  = 2000;
static const float    RR_TOL     = 0.25f;   // écart max à la médiane (25 %)
static const int      RR_CAP     = 60;      // fenêtre de calcul du RMSSD

// ------------------------------------------------------------------- état DSP
static float baseline = 0.0f;
static float smooth   = 0.0f;
static float env      = 0.0f;      // enveloppe d'amplitude du signal
static bool  armed    = false;     // hystérésis : on ne détecte qu'après une descente
static float prevSig  = 0.0f;

static double lastBeatMs = 0.0;
static uint32_t rr[RR_CAP];        // intervalles retenus, en ms
static bool     rrOk[RR_CAP];      // le RR précédent était-il valide ? (pour le RMSSD)
static int      rrCount = 0;
static int      rrHead  = 0;

static uint32_t beatsSeen = 0, beatsKept = 0;
static uint32_t lastReportMs = 0;

// RR accumulés depuis la dernière notification, à joindre à la trame HRM
static uint16_t pendingRR[8];
static int      pendingCount = 0;

// ------------------------------------------------------------------- état BLE
static NimBLECharacteristic* chrHRM    = nullptr;
static NimBLECharacteristic* chrBat    = nullptr;
static NimBLECharacteristic* chrStatus = nullptr;
static bool clientConnected = false;

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* s) override {
    clientConnected = true;
    Serial.println(F("{\"ble\":\"connected\"}"));
  }
  void onDisconnect(NimBLEServer* s) override {
    clientConnected = false;
    Serial.println(F("{\"ble\":\"disconnected\"}"));
    NimBLEDevice::startAdvertising();   // rester joignable par la borne
  }
};

// -----------------------------------------------------------------------------
//  Médiane des RR retenus — sert au rejet d'artefacts
// -----------------------------------------------------------------------------
static uint32_t medianRR() {
  if (rrCount == 0) return 0;
  uint32_t tmp[RR_CAP];
  memcpy(tmp, rr, sizeof(uint32_t) * rrCount);
  for (int i = 1; i < rrCount; i++) {          // tri par insertion, rrCount <= 60
    uint32_t k = tmp[i];
    int j = i - 1;
    while (j >= 0 && tmp[j] > k) { tmp[j + 1] = tmp[j]; j--; }
    tmp[j + 1] = k;
  }
  return tmp[rrCount / 2];
}

// -----------------------------------------------------------------------------
//  RMSSD — racine de la moyenne des carrés des différences successives.
//  On n'utilise une paire (RR[n], RR[n+1]) que si les deux ont été retenus :
//  un battement manqué fausserait complètement le résultat.
// -----------------------------------------------------------------------------
static float rmssd() {
  if (rrCount < 5) return 0.0f;
  double sum = 0.0;
  int n = 0;
  for (int i = 1; i < rrCount; i++) {
    int cur  = (rrHead - rrCount + i     + RR_CAP * 2) % RR_CAP;
    int prev = (rrHead - rrCount + i - 1 + RR_CAP * 2) % RR_CAP;
    if (!rrOk[cur] || !rrOk[prev]) continue;   // rupture de continuité
    double d = (double)rr[cur] - (double)rr[prev];
    sum += d * d;
    n++;
  }
  return n < 4 ? 0.0f : (float)sqrt(sum / n);
}

static float meanBpm() {
  if (rrCount < 3) return 0.0f;
  double s = 0.0;
  for (int i = 0; i < rrCount; i++) s += rr[i];
  return (float)(60000.0 / (s / rrCount));
}

static void pushRR(uint32_t v, bool valid) {
  rr[rrHead]   = v;
  rrOk[rrHead] = valid;
  rrHead = (rrHead + 1) % RR_CAP;
  if (rrCount < RR_CAP) rrCount++;

  // Le standard exprime les RR en 1/1024 s, pas en millisecondes.
  if (valid && pendingCount < 8) {
    pendingRR[pendingCount++] = (uint16_t)((v * 1024UL) / 1000UL);
  }
}

// -----------------------------------------------------------------------------
//  Qualité du signal : le bracelet doit dire quand il ne sait pas.
//  Une mesure douteuse remontée comme certaine est pire que pas de mesure.
// -----------------------------------------------------------------------------
static const char* quality() {
  if (env < 60.0f)   return "poor";      // amplitude trop faible : doigt absent
  if (beatsSeen < 8) return "warmup";
  float keep = (float)beatsKept / (float)beatsSeen;
  if (keep < 0.65f)  return "poor";      // trop d'artefacts : ça bouge
  if (keep < 0.85f)  return "fair";
  return "good";
}

static bool contactDetected() {
  const char* q = quality();
  return (strcmp(q, "good") == 0 || strcmp(q, "fair") == 0);
}

// -----------------------------------------------------------------------------
//  Trame Heart Rate Measurement (0x2A37), format du Bluetooth SIG
//
//    octet 0 : drapeaux
//        bit 0 — 0 = FC sur 8 bits, 1 = sur 16 bits
//        bit 1 — contact capteur détecté
//        bit 2 — capteur capable de détecter le contact
//        bit 3 — dépense énergétique présente
//        bit 4 — intervalles RR présents
//    octet 1 : fréquence cardiaque (bpm)
//    suite   : intervalles RR, uint16 petit-boutiste, unité 1/1024 s
// -----------------------------------------------------------------------------
static void notifyHRM() {
  uint8_t buf[2 + 8 * 2];
  uint8_t flags = 0x04;                      // bit 2 : contact géré par le capteur
  if (contactDetected()) flags |= 0x02;      // bit 1 : contact effectif
  if (pendingCount > 0)  flags |= 0x10;      // bit 4 : RR joints

  int bpm = (int)roundf(meanBpm());
  if (bpm < 0)   bpm = 0;
  if (bpm > 255) bpm = 255;

  int n = 0;
  buf[n++] = flags;
  buf[n++] = (uint8_t)bpm;
  for (int i = 0; i < pendingCount; i++) {
    buf[n++] = (uint8_t)(pendingRR[i] & 0xFF);
    buf[n++] = (uint8_t)(pendingRR[i] >> 8);
  }
  pendingCount = 0;

  chrHRM->setValue(buf, n);
  chrHRM->notify();
}

// -----------------------------------------------------------------------------
static String statusJson() {
  String j = "{";
  j += "\"id\":\"";      j += RESIDENT_ID;             j += "\",";
  j += "\"bpm\":";       j += String(meanBpm(), 1);    j += ",";
  j += "\"rmssd\":";     j += String(rmssd(), 1);      j += ",";
  j += "\"beats\":";     j += rrCount;                 j += ",";
  j += "\"amp\":";       j += String(env, 0);          j += ",";
  j += "\"q\":\"";       j += quality();               j += "\"";
  j += "}";
  return j;
}

// -----------------------------------------------------------------------------
static void setupBle() {
  NimBLEDevice::init(DEVICE_NAME);
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
  NimBLEDevice::setMTU(185);            // le JSON de statut dépasse les 20 octets

  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  NimBLEService* hrs = server->createService(UUID_HRS);
  chrHRM = hrs->createCharacteristic(UUID_HRM, NIMBLE_PROPERTY::NOTIFY);
  hrs->start();

  NimBLEService* bas = server->createService(UUID_BAS);
  chrBat = bas->createCharacteristic(UUID_BAT_LVL,
                                     NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  uint8_t lvl = 61;                     // simulé : l'ESP32 n'est pas sur batterie
  chrBat->setValue(&lvl, 1);
  bas->start();

  NimBLEService* sola = server->createService(UUID_SOLA_SVC);
  chrStatus = sola->createCharacteristic(UUID_SOLA_STATUS,
                                          NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  sola->start();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(UUID_HRS);        // repérable comme ceinture cardio standard
  adv->addServiceUUID(UUID_SOLA_SVC);
  adv->setScanResponse(true);
  adv->start();
}

// -----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(300);
  analogReadResolution(12);                       // 0 .. 4095
  analogSetPinAttenuation(PIN_PPG, ADC_11db);     // pleine échelle 0 .. 3,3 V

  // Amorce la ligne de base pour éviter 2 s de faux battements au démarrage.
  double acc = 0.0;
  for (int i = 0; i < 500; i++) { acc += analogRead(PIN_PPG); delayMicroseconds(PERIOD_US); }
  baseline = acc / 500.0;
  smooth   = 0.0f;

  setupBle();
  Serial.print(F("{\"boot\":\"sola-bracelet\",\"fs\":500,\"sensor\":\"KY-039\",\"ble\":\""));
  Serial.print(DEVICE_NAME);
  Serial.println(F("\"}"));
}

// -----------------------------------------------------------------------------
void loop() {
  static uint32_t nextSample = micros();

  // ---- échantillonnage à cadence fixe -------------------------------------
  if ((int32_t)(micros() - nextSample) < 0) return;
  nextSample += PERIOD_US;

  int raw = analogRead(PIN_PPG);

  // ---- chaîne de filtrage --------------------------------------------------
  baseline += A_BASE * ((float)raw - baseline);        // dérive lente
  float ac  = (float)raw - baseline;                   // pulsation seule
  smooth   += A_SMOOTH * (ac - smooth);                // lissage

  // ---- enveloppe adaptative ------------------------------------------------
  // Le seuil suit l'amplitude réelle du signal : pas de constante magique qui
  // ne marcherait que sur un doigt et une lumière donnés.
  if (smooth > env) env = smooth; else env *= 0.9992f;
  float thrHigh = 0.55f * env;
  float thrLow  = 0.25f * env;

  double nowMs = micros() / 1000.0;

  // ---- détection du front montant -----------------------------------------
  if (smooth < thrLow) armed = true;

  if (armed && prevSig <= thrHigh && smooth > thrHigh && env > 40.0f) {
    // Interpolation linéaire du franchissement : on gagne une précision
    // inférieure à la période d'échantillonnage sur l'instant du battement.
    float frac = (thrHigh - prevSig) / max(smooth - prevSig, 0.001f);
    double tBeat = nowMs - (1.0 - frac) * (1000.0 / FS);

    if (lastBeatMs > 0.0 && (tBeat - lastBeatMs) > REFRACT_MS) {
      uint32_t interval = (uint32_t)(tBeat - lastBeatMs);
      beatsSeen++;

      bool valid = (interval >= RR_MIN_MS && interval <= RR_MAX_MS);
      uint32_t med = medianRR();
      if (valid && med > 0) {
        float dev = fabsf((float)interval - (float)med) / (float)med;
        if (dev > RR_TOL) valid = false;   // battement manqué ou extrasystole
      }
      if (valid) beatsKept++;
      pushRR(interval, valid);

      lastBeatMs = tBeat;
      armed = false;
    } else if (lastBeatMs == 0.0) {
      lastBeatMs = tBeat;
      armed = false;
    }
  }
  prevSig = smooth;

  // ---- notification, une fois par seconde ---------------------------------
  uint32_t ms = millis();
  if (ms - lastReportMs >= 1000) {
    lastReportMs = ms;

    String j = statusJson();
    Serial.println(j);                    // le secours qui marche toujours

    if (clientConnected) {
      notifyHRM();
      chrStatus->setValue(j);
      chrStatus->notify();
    }
  }
}
