export interface Env {
  APP_ENV: string;
  APP_DATA_MODE?: string;
  DATABASE_URL?: string;
  REALTIME_SERVICE: Fetcher;
  MEDIA_SERVICE: Fetcher;
  MEDIA_CONTROL_SHARED_SECRET?: string;
  ANALYTICS?: AnalyticsEngineDataset;
}
