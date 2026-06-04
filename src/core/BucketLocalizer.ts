import { i18next } from "../i18n/i18n";
import type { PluginSettings } from "../settings";

type FixedT = (key: string) => string;

export class BucketLocalizer {
  static renameBuckets(settings: PluginSettings, oldLang: string, newLang: string): void {
    const tOld = i18next.getFixedT(oldLang || "en") as FixedT;
    const tNew = i18next.getFixedT(newLang || "en") as FixedT;
    for (const bucket of settings.buckets) {
      const key = `buckets.defaults.${bucket.id}.name`;
      if (i18next.exists(key) && bucket.name === tOld(key)) {
        bucket.name = tNew(key);
      }
    }
  }
}
