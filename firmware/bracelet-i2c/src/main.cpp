// =============================================================================
//  Sola — Bracelet résident (prototype, capteurs I²C)
//  ESP32 + MAX30102 (PPG rouge/infrarouge) + MPU6050 (accéléromètre)
//
//  Mesure
//    · fréquence cardiaque, intervalles RR, RMSSD      — MAX30102
//    · SpO₂ par rapport des rapports — NON CALIBRÉE    — MAX30102
//    · activité, secousses, chutes                     — MPU6050
//    · durée de sommeil estimée                        — les deux
//
//  Liaison BLE vers la borne de cabine — profils standard du Bluetooth SIG
//    · Heart Rate Service  0x180D  (FC + intervalles RR + contact)
//    · Battery Service     0x180F  (niveau de batterie)
//    · service Sola (custom)       (RMSSD, SpO₂, sommeil, activité, qualité)
//  + copie JSON sur le port série (secours de démonstration)
//
//  Câblage — les deux capteurs partagent le même bus, adresses différentes
//    MAX30102  VIN -> 3V3   GND -> GND   SDA -> GPIO21   SCL -> GPIO22   (0x57)
//    MPU6050   VCC -> 3V3   GND -> GND   SDA -> GPIO21   SCL -> GPIO22   (0x68)
//
//  Le MAX30102 est un capteur par RÉFLEXION : pour la démonstration, pose le
//  doigt dessus. Au poignet le signal est 5 à 10 fois plus faible.
//
//  ATTENTION : nécessite un ESP32 avec Bluetooth (ESP32 classique, S3, C3).
//  L'ESP32-S2 n'a PAS de radio Bluetooth.
// =============================================================================

#include <Arduino.h>
#include <Wire.h>
#include <NimBLEDevice.h>
#include "MAX30105.h"   // la bibliothèque SparkFun pilote aussi le MAX30102

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
static const int   PIN_SDA   = 21;
static const int   PIN_SCL   = 22;
static const int   FS_PPG    = 400;                  // Hz, cadence du MAX30102
static const float PERIOD_MS = 1000.0f / FS_PPG;
static const uint32_t MPU_PERIOD_MS = 20;            // 50 Hz, largement assez

// ------------------------------------------------------------------- filtrage
// Mêmes constantes de temps que la version analogique, réajustées à 400 Hz.
static const float A_BASE   = 0.0025f;  // passe-bas très lent  (~0,16 Hz)
static const float A_SMOOTH = 0.22f;    // passe-bas de lissage (~15 Hz)

// ------------------------------------------------------------- détection RR
static const uint32_t REFRACT_MS = 300; // 300 ms => 200 bpm maximum
static const uint32_t RR_MIN_MS  = 300;
static const uint32_t RR_MAX_MS  = 2000;
static const float    RR_TOL     = 0.25f;   // écart max à la médiane (25 %)
static const int      RR_CAP     = 60;      // fenêtre de calcul du RMSSD

// ------------------------------------------------------------------- présence
// Niveau continu d'infrarouge en dessous duquel il n'y a pas de peau devant le
// capteur. À vérifier sur ta carte : affiche `ir` sur le port série, doigt posé
// puis doigt retiré, et prends la moitié de l'écart.
static const float IR_CONTACT = 20000.0f;
static const float ENV_MIN    = 50.0f;      // amplitude de pulsation minimale

// ===================== SOMMEIL ===============================================
//  Méthode volontairement simple : on considère que le résident dort quand il
//  ne bouge pas ET que son cœur est descendu sous sa base de repos.
//
//  C'est de l'actigraphie de premier niveau. Elle SURESTIME le sommeil : rester
//  allongé éveillé, immobile et détendu est classé comme du sommeil. Compter
//  une erreur de l'ordre de la demi-heure sur une nuit. Ne jamais présenter le
//  résultat comme une mesure : c'est une estimation.
// =============================================================================
static const uint32_t EPOCH_MS = 60000;     // 1 époque = 1 minute
// Pour une démonstration, mets EPOCH_MS à 5000 : une « nuit » se joue alors en
// quelques minutes, tous les seuils ci-dessous suivent automatiquement.

static const int   ONSET_EPOCHS = 15;       // 15 min de calme => endormi
static const int   WAKE_EPOCHS  = 5;        // 5 min d'agitation => réveillé
static const int   RESET_EPOCHS = 120;      // 2 h debout => la nuit est close
static const int   WARMUP_EPOCHS = 3;       // le temps d'avoir une base de repos
static const float MOVE_TH      = 0.012f;   // g, activité moyenne par échantillon
static const float HR_DROP      = 4.0f;     // bpm sous la base de repos éveillé

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

// Horloge d'échantillonnage : le MAX30102 cadence lui-même ses conversions, on
// compte les échantillons plutôt que de lire millis(). La FIFO arrive par
// paquets, millis() introduirait une gigue de plusieurs millisecondes sur les RR.
//
// Limite connue : si la boucle principale traîne assez pour laisser déborder la
// FIFO (32 échantillons, soit 80 ms à 400 Hz), les échantillons perdus ne sont
// pas comptés et les intervalles RR de cette seconde-là sont raccourcis. Le
// rejet d'artefacts les écarte, mais garde la boucle légère.
static double  sampleClockMs = 0.0;

// ------------------------------------------------------------------- SpO₂
static float irDc = 0.0f, redDc = 0.0f;                 // niveaux continus
static uint32_t irMin = 0xFFFFFFFF, irMax = 0;          // extrêmes de la seconde
static uint32_t redMin = 0xFFFFFFFF, redMax = 0;
static float spo2 = 0.0f;                               // 0 = pas de valeur fiable

// ------------------------------------------------------------------ MPU6050
static const uint8_t MPU_ADDR = 0x68;
static bool  mpuPresent = false;
static float magPrev    = 1.0f;

static double actSum = 0.0;        // somme des |Δ| sur l'époque en cours
static uint32_t actN = 0;
static float    activity = 0.0f;   // dernière valeur consolidée

static uint32_t fallCount = 0, shakeCount = 0;
static uint32_t freeFallAt = 0, lastShakeAt = 0;

// ------------------------------------------------------------------- sommeil
static float hrRest = 0.0f;        // base de repos éveillé, gelée pendant le sommeil
static bool  asleep = false;
static int   runSleep = 0, runWake = 0;
static uint32_t tstMin = 0, wasoMin = 0;   // en époques, pas en minutes réelles
static uint32_t epochIndex = 0;
static uint32_t lastEpochMs = 0;

// ------------------------------------------------------------------- état BLE
static MAX30105 ppg;
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
//  MPU6050 — accès direct au bus, la poignée de registres dont on a besoin ne
//  justifie pas une bibliothèque de plus.
// -----------------------------------------------------------------------------
static void mpuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

static bool mpuBegin() {
  Wire.beginTransmission(MPU_ADDR);
  if (Wire.endTransmission() != 0) return false;
  mpuWrite(0x6B, 0x00);   // PWR_MGMT_1  : sortie de veille
  delay(50);
  mpuWrite(0x1C, 0x00);   // ACCEL_CONFIG: pleine échelle ±2 g
  mpuWrite(0x1A, 0x03);   // CONFIG      : filtre passe-bas interne à 44 Hz
  return true;
}

// Norme du vecteur accélération, en g. Au repos elle vaut 1 quelle que soit
// l'orientation du bracelet — c'est ce qui rend la mesure indépendante de la
// position du poignet.
static bool mpuReadMagnitude(float& mag) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);                             // ACCEL_XOUT_H
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)MPU_ADDR, 6) != 6) return false;

  // Les deux octets sont lus séparément : l'ordre d'évaluation des opérandes
  // de `|` n'est pas garanti par le langage.
  uint8_t hx = Wire.read(), lx = Wire.read();
  uint8_t hy = Wire.read(), ly = Wire.read();
  uint8_t hz = Wire.read(), lz = Wire.read();

  int16_t rx = (int16_t)((hx << 8) | lx);
  int16_t ry = (int16_t)((hy << 8) | ly);
  int16_t rz = (int16_t)((hz << 8) | lz);

  const float SCALE = 16384.0f;                 // LSB par g en ±2 g
  float ax = rx / SCALE, ay = ry / SCALE, az = rz / SCALE;
  mag = sqrtf(ax * ax + ay * ay + az * az);
  return true;
}

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
  if (irDc < IR_CONTACT) return "poor";        // rien devant le capteur
  if (env < ENV_MIN)     return "poor";        // pas de pulsation exploitable
  if (beatsSeen < 8)     return "warmup";
  float keep = (float)beatsKept / (float)beatsSeen;
  if (keep < 0.65f)      return "poor";        // trop d'artefacts : ça bouge
  if (keep < 0.85f)      return "fair";
  return "good";
}

static bool contactDetected() {
  const char* q = quality();
  return (strcmp(q, "good") == 0 || strcmp(q, "fair") == 0);
}

// -----------------------------------------------------------------------------
//  Traitement d'un échantillon PPG (infrarouge pour la pulsation, rouge pour
//  la SpO₂). Appelé FS_PPG fois par seconde depuis la FIFO du capteur.
// -----------------------------------------------------------------------------
static void processPpg(uint32_t ir, uint32_t red) {
  sampleClockMs += PERIOD_MS;

  // Niveaux continus : présence de la peau et dénominateur de la SpO₂.
  irDc  += A_BASE * ((float)ir  - irDc);
  redDc += A_BASE * ((float)red - redDc);

  if (ir  < irMin)  irMin  = ir;
  if (ir  > irMax)  irMax  = ir;
  if (red < redMin) redMin = red;
  if (red > redMax) redMax = red;

  // ---- chaîne de filtrage --------------------------------------------------
  baseline += A_BASE * ((float)ir - baseline);       // dérive lente
  float ac  = (float)ir - baseline;                  // pulsation seule
  smooth   += A_SMOOTH * (ac - smooth);              // lissage

  // Le signe de la pulsation dépend du montage optique : selon la carte, le
  // systole est une bosse ou un creux. Sans importance ici — on mesure l'écart
  // entre deux franchissements successifs, qui vaut un cycle cardiaque dans
  // les deux cas.

  // ---- enveloppe adaptative ------------------------------------------------
  // Le seuil suit l'amplitude réelle du signal : pas de constante magique qui
  // ne marcherait que sur un doigt et une carte donnés.
  if (smooth > env) env = smooth; else env *= 0.9992f;
  float thrHigh = 0.55f * env;
  float thrLow  = 0.25f * env;

  // ---- détection du front montant -----------------------------------------
  if (smooth < thrLow) armed = true;

  if (armed && prevSig <= thrHigh && smooth > thrHigh && env > ENV_MIN) {
    // Interpolation linéaire du franchissement : on gagne une précision
    // inférieure à la période d'échantillonnage sur l'instant du battement.
    float frac = (thrHigh - prevSig) / max(smooth - prevSig, 0.001f);
    double tBeat = sampleClockMs - (1.0 - frac) * PERIOD_MS;

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
}

// -----------------------------------------------------------------------------
//  SpO₂ par le rapport des rapports, une fois par seconde.
//
//    R = (AC_rouge / DC_rouge) / (AC_infrarouge / DC_infrarouge)
//    SpO₂ ≈ 110 − 25·R
//
//  Cette droite est empirique. Les oxymètres du commerce sont étalonnés sur des
//  volontaires en désaturation contrôlée ; nous ne le sommes pas. La valeur est
//  plausible, elle n'est pas médicale — l'interface DOIT l'étiqueter.
// -----------------------------------------------------------------------------
static void updateSpo2() {
  float acIr  = (float)irMax  - (float)irMin;
  float acRed = (float)redMax - (float)redMin;
  irMin = redMin = 0xFFFFFFFF;
  irMax = redMax = 0;

  if (irDc < IR_CONTACT || acIr < ENV_MIN || redDc < 1.0f) { spo2 = 0.0f; return; }

  float r = (acRed / redDc) / (acIr / irDc);
  float v = 110.0f - 25.0f * r;
  if (v > 100.0f) v = 100.0f;
  if (v < 70.0f)  v = 70.0f;

  spo2 = (spo2 <= 0.0f) ? v : spo2 + 0.25f * (v - spo2);   // lissage
}

// -----------------------------------------------------------------------------
//  Fin d'époque : c'est ici que se décide « il dort » ou « il est réveillé ».
// -----------------------------------------------------------------------------
static void closeEpoch() {
  epochIndex++;

  activity = (actN > 0) ? (float)(actSum / actN) : 0.0f;
  actSum = 0.0;
  actN   = 0;

  float bpm = meanBpm();
  bool  usable = contactDetected() && bpm > 30.0f && bpm < 200.0f;

  // --- base de repos éveillé -----------------------------------------------
  // Descend vite, remonte lentement : elle se cale sur les moments calmes de la
  // journée plutôt que sur la moyenne. Gelée pendant le sommeil, sinon elle
  // suivrait le cœur qui ralentit et la détection s'éteindrait d'elle-même.
  if (usable && !asleep) {
    if (hrRest <= 0.0f)   hrRest = bpm;
    else if (bpm < hrRest) hrRest += 0.20f * (bpm - hrRest);
    else                   hrRest += 0.02f * (bpm - hrRest);
  }

  // --- les deux conditions --------------------------------------------------
  bool quiet   = (activity < MOVE_TH);
  bool hrLow   = (hrRest > 0.0f && usable && bpm < hrRest - HR_DROP);
  bool ready   = (epochIndex > (uint32_t)WARMUP_EPOCHS && hrRest > 0.0f);
  bool epochAsleep = ready && quiet && hrLow;

  if (epochAsleep) { runSleep++; runWake = 0; }
  else             { runWake++;  runSleep = 0; }

  if (!asleep) {
    if (runSleep >= ONSET_EPOCHS) {
      asleep = true;
      tstMin += runSleep;              // les minutes de calme déjà écoulées comptent
      Serial.print(F("[sommeil] endormissement a l'epoque "));
      Serial.println(epochIndex);
    } else if (tstMin > 0 && runWake >= RESET_EPOCHS) {
      // Debout depuis deux heures : la nuit est terminée, on publie et on remet
      // les compteurs à zéro pour la nuit suivante.
      uint32_t tib = tstMin + wasoMin;
      if (tib == 0) tib = 1;
      Serial.print(F("[sommeil] NUIT TERMINEE  tst="));
      Serial.print(tstMin);
      Serial.print(F(" min  waso="));
      Serial.print(wasoMin);
      Serial.print(F(" min  efficacite="));
      Serial.print((int)roundf(100.0f * (float)tstMin / (float)tib));
      Serial.println(F(" %"));
      tstMin = wasoMin = 0;
    }
  } else {
    if (epochAsleep) {
      tstMin++;
    } else {
      wasoMin++;                       // éveil intra-sommeil
      if (runWake >= WAKE_EPOCHS) {
        asleep = false;
        Serial.print(F("[sommeil] reveil a l'epoque "));
        Serial.println(epochIndex);
      }
    }
  }

  // Une ligne par époque : c'est ce journal que tu compareras à l'heure de
  // coucher notée à la main pour chiffrer l'erreur de la méthode.
  String e = "[epoque ";
  e += epochIndex;
  e += "] act=";    e += String(activity, 4);
  e += " bpm=";     e += String(bpm, 0);
  e += " repos=";   e += String(hrRest, 0);
  e += " dort=";    e += (asleep ? 1 : 0);
  e += " tst=";     e += tstMin;
  e += " waso=";    e += wasoMin;
  Serial.println(e);
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
  j += "\"id\":\"";   j += RESIDENT_ID;          j += "\",";
  j += "\"bpm\":";    j += String(meanBpm(), 1);  j += ",";
  j += "\"rmssd\":";  j += String(rmssd(), 1);    j += ",";
  j += "\"spo2\":";   j += String(spo2, 0);       j += ",";
  j += "\"act\":";    j += String(activity, 4);   j += ",";
  j += "\"sleep\":";  j += (asleep ? 1 : 0);      j += ",";
  j += "\"tst\":";    j += tstMin;                j += ",";
  j += "\"waso\":";   j += wasoMin;               j += ",";
  j += "\"hrRest\":"; j += String(hrRest, 0);     j += ",";
  j += "\"fall\":";   j += fallCount;             j += ",";
  j += "\"shake\":";  j += shakeCount;            j += ",";
  j += "\"q\":\"";    j += quality();             j += "\"";
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

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);

  if (!ppg.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println(F("{\"erreur\":\"MAX30102 introuvable — verifie SDA/SCL et l'alimentation 3V3\"}"));
    while (true) delay(1000);           // sans PPG, rien à mesurer
  }
  // powerLevel, moyennage, mode (2 = rouge + IR), cadence, largeur d'impulsion,
  // pleine échelle de l'ADC. Moyennage à 1 : on veut les 400 Hz bruts pour la
  // précision des intervalles RR.
  ppg.setup(0x3F, 1, 2, FS_PPG, 411, 4096);

  mpuPresent = mpuBegin();
  if (!mpuPresent) {
    Serial.println(F("{\"avertissement\":\"MPU6050 absent — pas d'activite, pas de sommeil\"}"));
  }

  // Amorce les lignes de base pour éviter quelques secondes de faux battements.
  uint32_t t0 = millis();
  double accIr = 0.0;
  uint32_t n = 0;
  while (millis() - t0 < 500) {
    ppg.check();
    while (ppg.available()) {
      accIr += ppg.getFIFOIR();
      redDc  = ppg.getFIFORed();
      ppg.nextSample();
      n++;
    }
  }
  if (n > 0) { baseline = accIr / n; irDc = baseline; }
  smooth = 0.0f;

  lastEpochMs = millis();

  setupBle();
  Serial.print(F("{\"boot\":\"sola-bracelet\",\"fs\":400,\"sensor\":\"MAX30102+MPU6050\",\"ble\":\""));
  Serial.print(DEVICE_NAME);
  Serial.println(F("\"}"));
}

// -----------------------------------------------------------------------------
void loop() {
  uint32_t ms = millis();

  // ---- PPG : on vide la FIFO à chaque tour ---------------------------------
  ppg.check();
  while (ppg.available()) {
    uint32_t ir  = ppg.getFIFOIR();
    uint32_t red = ppg.getFIFORed();
    ppg.nextSample();
    processPpg(ir, red);
  }

  // ---- accéléromètre, à 50 Hz ----------------------------------------------
  static uint32_t nextMpu = 0;
  if (mpuPresent && (int32_t)(ms - nextMpu) >= 0) {
    nextMpu = ms + MPU_PERIOD_MS;

    float mag;
    if (mpuReadMagnitude(mag)) {
      // Activité = variation moyenne d'un échantillon au suivant. Au repos
      // complet elle vaut le bruit du capteur, quelques millièmes de g.
      actSum += fabsf(mag - magPrev);
      actN++;

      // Chute : quasi-apesanteur suivie d'un impact dans la seconde.
      if (mag < 0.40f) freeFallAt = ms;
      if (mag > 2.50f && freeFallAt != 0 && ms - freeFallAt < 1000) {
        fallCount++;
        freeFallAt = 0;
        Serial.println(F("{\"evenement\":\"chute\"}"));
      }
      // Secousse : mouvement brusque isolé, sans chute libre préalable.
      else if (mag > 1.60f && ms - lastShakeAt > 400) {
        shakeCount++;
        lastShakeAt = ms;
      }

      magPrev = mag;
    }
  }

  // ---- fin d'époque ---------------------------------------------------------
  if (ms - lastEpochMs >= EPOCH_MS) {
    lastEpochMs += EPOCH_MS;
    closeEpoch();
  }

  // ---- notification, une fois par seconde ---------------------------------
  if (ms - lastReportMs >= 1000) {
    lastReportMs = ms;
    updateSpo2();

    String j = statusJson();
    Serial.println(j);                    // le secours qui marche toujours

    if (clientConnected) {
      notifyHRM();
      chrStatus->setValue(j);
      chrStatus->notify();
    }
  }
}
