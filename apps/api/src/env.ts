function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

/** Read lazily so tests can set process.env before first use. */
export const env = {
  get databaseUrl() {
    return required('DATABASE_URL');
  },
  get redisUrl() {
    return required('REDIS_URL');
  },
  get jwtSecret() {
    return required('JWT_SECRET');
  },
  get serviceToken() {
    return required('SERVICE_TOKEN');
  },
  get dataDir() {
    return process.env.DATA_DIR ?? '/data';
  },
  get webOrigin() {
    return (process.env.WEB_ORIGIN ?? 'http://localhost:8080').split(',');
  },
  get maxImages() {
    return Number(process.env.MAX_IMAGES ?? 200);
  },
  get minImages() {
    return Number(process.env.MIN_IMAGES ?? 3);
  },
  get pollMs() {
    return Number(process.env.POLL_MS ?? 2000);
  },
  get maxFileBytes() {
    return Math.floor(Number(process.env.MAX_FILE_MB ?? 40) * 1024 * 1024);
  },
  get minFreeDiskBytes() {
    return Number(process.env.MIN_FREE_DISK_GB ?? 5) * 1024 ** 3;
  },
  get logLevel() {
    return process.env.LOG_LEVEL ?? 'info';
  },
  get secureCookies() {
    return process.env.COOKIE_SECURE === 'true';
  },
  services: {
    get vision() {
      return process.env.VISION_URL ?? 'http://vision:8000';
    },
    get recon() {
      return process.env.RECON_URL ?? 'http://recon:8000';
    },
    get geometry() {
      return process.env.GEOMETRY_URL ?? 'http://geometry:8000';
    },
  },
};

export type ServiceName = 'vision' | 'recon' | 'geometry';
export const SERVICE_NAMES: ServiceName[] = ['vision', 'recon', 'geometry'];
