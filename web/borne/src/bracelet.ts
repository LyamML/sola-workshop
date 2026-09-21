// =============================================================================
//  Sola — client BLE du bracelet, côté borne de cabine
//
//  Web Bluetooth : Chrome ou Edge uniquement, en contexte sécurisé
//  (localhost suffit). L'appairage exige un clic utilisateur — appelle
//  connectBracelet() depuis le gestionnaire d'un bouton, jamais au chargement.
// =============================================================================

const UUID_HRS = 0x180d; // Heart Rate Service
const UUID_HRM = 0x2a37; // Heart Rate Measurement
const UUID_BAS = 0x180f; // Battery Service
const UUID_BAT = 0x2a19; // Battery Level

const UUID_SOLA_SVC = "7a0b1000-5e4d-4b7a-9c3f-1e2d3c4b5a60";
const UUID_SOLA_STATUS = "7a0b1001-5e4d-4b7a-9c3f-1e2d3c4b5a60";

/** Qualité du signal telle que le bracelet l'estime lui-même. */
export type Quality = "good" | "fair" | "poor" | "warmup";

export interface BraceletReading {
  /** Fréquence cardiaque en battements par minute. */
  bpm: number;
  /** Intervalles entre battements, en millisecondes, depuis la trame précédente. */
  rr: number[];
  /** Le capteur estime-t-il être en contact avec la peau ? */
  contact: boolean;
  /** Variabilité cardiaque (RMSSD) en ms — calculée par le bracelet. */
  rmssd?: number;
  /** Nombre de battements dans la fenêtre de calcul du RMSSD. */
  beats?: number;
  /** Saturation en oxygène, en %. Non calibrée — toujours l'étiqueter comme telle. */
  spo2?: number;
  /** Activité moyenne par échantillon, en g. Proche de zéro au repos. */
  activity?: number;
  /** Le bracelet estime-t-il que le résident dort en ce moment ? */
  asleep?: boolean;
  /** Temps de sommeil total estimé depuis l'endormissement, en minutes. */
  sleepMinutes?: number;
  /** Éveils intra-sommeil cumulés, en minutes. */
  wakeMinutes?: number;
  /** Base de repos éveillé du résident, en bpm — la référence du seuil de sommeil. */
  restingBpm?: number;
  /** Chutes détectées depuis le démarrage. */
  falls?: number;
  /** Mouvements brusques détectés depuis le démarrage. */
  shakes?: number;
  quality?: Quality;
  batteryPercent?: number;
  at: Date;
}

export interface BraceletHandlers {
  onReading: (r: BraceletReading) => void;
  onDisconnect?: () => void;
}

/**
 * Décode une trame Heart Rate Measurement (0x2A37) du Bluetooth SIG.
 *
 *   octet 0 : drapeaux
 *       bit 0 — 0 = FC sur 8 bits, 1 = sur 16 bits
 *       bit 1 — contact capteur détecté
 *       bit 2 — capteur capable de détecter le contact
 *       bit 3 — dépense énergétique présente
 *       bit 4 — intervalles RR présents
 *   octet 1 : fréquence cardiaque
 *   suite   : intervalles RR, uint16 petit-boutiste, unité 1/1024 s
 */
function parseHeartRate(view: DataView): { bpm: number; rr: number[]; contact: boolean } {
  const flags = view.getUint8(0);
  const wide = (flags & 0x01) !== 0;
  const contactSupported = (flags & 0x04) !== 0;
  const contact = contactSupported ? (flags & 0x02) !== 0 : true;

  let offset = 1;
  const bpm = wide ? view.getUint16(offset, true) : view.getUint8(offset);
  offset += wide ? 2 : 1;

  if ((flags & 0x08) !== 0) offset += 2; // dépense énergétique : ignorée

  const rr: number[] = [];
  if ((flags & 0x10) !== 0) {
    for (; offset + 1 < view.byteLength; offset += 2) {
      // Conversion depuis l'unité 1/1024 s du standard vers les millisecondes.
      rr.push(Math.round((view.getUint16(offset, true) * 1000) / 1024));
    }
  }
  return { bpm, rr, contact };
}

/**
 * Ouvre le sélecteur d'appareil, s'appaire au bracelet et s'abonne aux
 * notifications. Retourne une fonction de déconnexion.
 */
export async function connectBracelet(handlers: BraceletHandlers): Promise<() => void> {
  if (!("bluetooth" in navigator)) {
    throw new Error(
      "Ce navigateur ne gère pas le Bluetooth. Utilisez Chrome ou Edge sur la borne.",
    );
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [UUID_HRS] }],
    optionalServices: [UUID_BAS, UUID_SOLA_SVC],
  });

  const server = await device.gatt!.connect();

  // État courant : les deux caractéristiques notifient séparément, on les
  // fusionne pour ne remonter qu'une seule lecture cohérente à l'interface.
  let latest: Partial<BraceletReading> = {};

  const emit = (patch: Partial<BraceletReading>) => {
    latest = { ...latest, ...patch };
    if (latest.bpm === undefined) return; // rien d'exploitable tant qu'il n'y a pas de FC
    handlers.onReading({
      ...latest,
      bpm: latest.bpm,
      rr: latest.rr ?? [],
      contact: latest.contact ?? false,
      at: new Date(),
    });
  };

  // --- fréquence cardiaque + intervalles RR (profil standard) ---------------
  const hrs = await server.getPrimaryService(UUID_HRS);
  const hrm = await hrs.getCharacteristic(UUID_HRM);
  hrm.addEventListener("characteristicvaluechanged", (event) => {
    const view = (event.target as BluetoothRemoteGATTCharacteristic).value!;
    emit(parseHeartRate(view));
  });
  await hrm.startNotifications();

  // --- RMSSD et qualité (service propre à Sola) ---------------------------
  // Optionnel : une ceinture cardio du commerce n'expose pas ce service, et la
  // borne doit continuer de fonctionner avec la seule fréquence cardiaque.
  try {
    const svc = await server.getPrimaryService(UUID_SOLA_SVC);
    const status = await svc.getCharacteristic(UUID_SOLA_STATUS);
    status.addEventListener("characteristicvaluechanged", (event) => {
      const view = (event.target as BluetoothRemoteGATTCharacteristic).value!;
      try {
        const json = JSON.parse(new TextDecoder().decode(view));
        emit({
          rmssd: json.rmssd,
          beats: json.beats,
          // 0 signifie « pas de valeur fiable » côté bracelet, pas « 0 % ».
          spo2: json.spo2 > 0 ? json.spo2 : undefined,
          activity: json.act,
          asleep: json.sleep === 1,
          sleepMinutes: json.tst,
          wakeMinutes: json.waso,
          restingBpm: json.hrRest > 0 ? json.hrRest : undefined,
          falls: json.fall,
          shakes: json.shake,
          quality: json.q,
        });
      } catch {
        /* trame tronquée : on garde la lecture précédente */
      }
    });
    await status.startNotifications();
  } catch {
    /* service absent — on se contente du profil standard */
  }

  // --- batterie -------------------------------------------------------------
  try {
    const bas = await server.getPrimaryService(UUID_BAS);
    const bat = await bas.getCharacteristic(UUID_BAT);
    emit({ batteryPercent: (await bat.readValue()).getUint8(0) });
    bat.addEventListener("characteristicvaluechanged", (event) => {
      const view = (event.target as BluetoothRemoteGATTCharacteristic).value!;
      emit({ batteryPercent: view.getUint8(0) });
    });
    await bat.startNotifications();
  } catch {
    /* service absent */
  }

  device.addEventListener("gattserverdisconnected", () => handlers.onDisconnect?.());

  return () => {
    if (device.gatt?.connected) device.gatt.disconnect();
  };
}
