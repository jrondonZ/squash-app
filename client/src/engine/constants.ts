/**
 * Court geometry and physical constants.
 *
 * Dimensions follow the WSF singles court specification (all values converted
 * to metres). Where the PSA World Tour deviates from the recreational standard
 * — most notably the 430 mm tin — both numbers are provided and the tour value
 * is the default.
 *
 * Coordinate frame, used by every module:
 *
 *   +x → towards the RIGHT side wall when standing at the back looking forward
 *   +y → up from the floor
 *   +z → back, away from the front wall
 *
 *   front wall = z 0, back wall = z 9.75, floor = y 0
 *   court centre line = x 0, side walls = x ±3.2
 */

// ---------------------------------------------------------------------------
// Court
// ---------------------------------------------------------------------------

export const COURT = {
  /** Front wall to back wall. */
  length: 9.75,
  /** Side wall to side wall. */
  width: 6.4,
  halfWidth: 3.2,

  /** Out line height on the front wall. */
  frontWallOutHeight: 4.57,
  /** Out line height on the back wall. */
  backWallOutHeight: 2.13,

  /** Board ("tin") height. The World Tour lowered the men's tin to 430 mm. */
  tinHeightTour: 0.43,
  tinHeightStandard: 0.48,

  /** Service line on the front wall — a serve must strike above this. */
  serviceLineHeight: 1.78,

  /** Distance from the front wall to the short line. */
  shortLine: 5.485,

  /** Service boxes are 1.6 m squares in the back corners of the front court. */
  serviceBoxSize: 1.6,

  /** Glass back wall on a show court is fully transparent above the floor. */
  backWallThickness: 0.05,

  /** Playing surface — a sprung maple floor. */
  floorFriction: 0.42,
} as const;

/** Depth of the back of the service box, i.e. short line + box size. */
export const SERVICE_BOX_BACK = COURT.shortLine + COURT.serviceBoxSize;

/**
 * The side wall out line runs as a straight line from the front wall out line
 * down to the back wall out line. Returns the legal height at a given depth.
 */
export const sideWallOutHeight = (z: number): number => {
  const t = Math.min(Math.max(z / COURT.length, 0), 1);
  return COURT.frontWallOutHeight + (COURT.backWallOutHeight - COURT.frontWallOutHeight) * t;
};

/** `side` is -1 for the left service box, +1 for the right. */
export const serviceBox = (side: -1 | 1) => ({
  minX: side < 0 ? -COURT.halfWidth : COURT.serviceBoxSize,
  maxX: side < 0 ? -COURT.serviceBoxSize : COURT.halfWidth,
  minZ: COURT.shortLine,
  maxZ: SERVICE_BOX_BACK,
});

/**
 * The quarter court a serve must land in: back court, opposite side to the box
 * the server used. Bounded by the short line, half-court line and back wall.
 */
export const receivingQuarter = (serveSide: -1 | 1) => ({
  minX: serveSide < 0 ? 0 : -COURT.halfWidth,
  maxX: serveSide < 0 ? COURT.halfWidth : 0,
  minZ: COURT.shortLine,
  maxZ: COURT.length,
});

// ---------------------------------------------------------------------------
// Ball
// ---------------------------------------------------------------------------

export const BALL = {
  /** Double yellow dot: 40 mm diameter, 24 g. */
  radius: 0.02,
  mass: 0.024,

  /**
   * A squash ball is famously dead when cold and lively when hot. Rebound
   * resilience is measured by dropping from 100 in; a double yellow returns
   * ~12 in at 23 °C and ~26–33 in at match temperature, which is a coefficient
   * of restitution moving from roughly 0.35 to 0.56.
   */
  corCold: 0.345,
  corHot: 0.56,
  tempCold: 20,
  tempHot: 45,
  /** A ball in play settles around 45 °C and physically cannot run away. */
  tempMax: 52,

  /** Front/side wall plaster is slightly livelier than the sprung floor. */
  wallCorFactor: 1.0,
  floorCorFactor: 0.94,
  /** The tin is a resonant board — it kills the ball and rings out. */
  tinCorFactor: 0.5,
  /** Glass back wall on a show court. */
  glassCorFactor: 1.04,

  /** Tangential friction at a wall impact, which converts spin to direction. */
  surfaceFriction: 0.31,
  /** Fraction of contact-patch slip fed back into the ball's spin. */
  spinCoupling: 0.42,

  /** Degrees of heating per joule of impact energy absorbed by the rubber. */
  heatPerImpact: 0.055,
  /** Newton cooling rate back towards ambient, per second. */
  coolRate: 0.03,

  /** Spin bleeds off through air resistance. */
  spinDecay: 0.55,

  /** Below this speed the ball is considered to have stopped rolling. */
  restSpeed: 0.35,
} as const;

// ---------------------------------------------------------------------------
// Air
// ---------------------------------------------------------------------------

export const AIR = {
  density: 1.2,
  /** Drag coefficient of a sphere in the Reynolds range a squash ball lives in. */
  dragCoefficient: 0.52,
  /** Peak Magnus lift coefficient, reached at high spin parameters. */
  maxLiftCoefficient: 0.26,
  gravity: 9.81,
} as const;

/**
 * Pre-computed drag term: acceleration = DRAG_K * speed² opposing velocity.
 *   k = ½ ρ Cd A / m
 */
export const DRAG_K =
  (0.5 * AIR.density * AIR.dragCoefficient * Math.PI * BALL.radius * BALL.radius) /
  BALL.mass;

/** Pre-computed Magnus term: ½ ρ A / m, scaled by the lift coefficient later. */
export const MAGNUS_K =
  (0.5 * AIR.density * Math.PI * BALL.radius * BALL.radius) / BALL.mass;

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export const PLAYER = {
  /** Shoulder height of the model, used for body-contact tests. */
  height: 1.8,
  /** Radius of the capsule used for interference and body-out checks. */
  bodyRadius: 0.28,

  /** Racket head reach from the body centre with a normal swing. */
  reach: 1.42,
  /** Extra reach bought by a full lunge. */
  lungeReach: 0.72,
  /** Highest point the racket can reach for a volley or smash. */
  maxReachHeight: 2.55,

  /** Base locomotion, modulated per character by their `speed` attribute. */
  baseAccel: 18.0,
  baseMaxSpeed: 5.6,
  /** Players decelerate harder than they accelerate — that is the split step. */
  decelFactor: 1.9,

  /** Seconds from swing start to racket–ball contact. */
  backswingTime: 0.17,
  /** Seconds of recovery after contact before the next swing can start. */
  recoveryTime: 0.13,
  /** Half-width of the timing window that still produces a clean strike. */
  contactWindow: 0.075,

  /** T position — where a player recovers to between shots. */
  tPosition: { x: 0, z: COURT.shortLine + 0.15 },

  /** Stamina drained per metre travelled at full tilt, in stamina points. */
  staminaPerMetre: 0.38,
  staminaPerSwing: 0.55,
  staminaPerLunge: 1.1,
  /** Recovery per second while stationary between rallies. */
  staminaRecovery: 3.4,
  maxStamina: 100,
} as const;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const RULES = {
  /** Point-a-rally scoring to 11, win by two. */
  pointsToWinGame: 11,
  winByMargin: 2,
  /** Best of five games. */
  gamesToWinMatch: 3,
  maxGames: 5,

  /** Seconds allowed between games. */
  betweenGamesSeconds: 90,
  /** Seconds between the end of one rally and the next serve. */
  betweenRalliesSeconds: 7,
  /** Self-inflicted injury allowance. */
  injuryTimeSeconds: 180,

  /** PSA video review: one unsuccessful review per game, retained if upheld. */
  reviewsPerGame: 1,

  /** A serve struck before the referee calls play is a fault. */
  serveTimeoutSeconds: 10,
} as const;

/** Conduct ladder as applied by the referee, in escalating order. */
export const CONDUCT_LADDER = ['warning', 'stroke', 'game', 'match'] as const;
export type ConductPenalty = (typeof CONDUCT_LADDER)[number];

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export const SIM = {
  /** Logic runs at a fixed 60 Hz. */
  tickRate: 60,
  tickDelta: 1 / 60,
  /**
   * The ball is integrated at 480 Hz. At 70 m/s it still travels 15 cm per
   * physics step, so continuous collision detection is mandatory regardless —
   * but the finer step keeps the aerodynamic integration honest.
   */
  physicsSubsteps: 8,
  /** Snapshots pushed to remote peers per second. */
  netSnapshotRate: 20,
  /** Seconds of rally history kept for replays and video review. */
  replayBufferSeconds: 30,
} as const;

export const PHYSICS_DELTA = SIM.tickDelta / SIM.physicsSubsteps;
