import { getMemoryStore, type MemoryStoreAccessor } from "../store";
import type { ExternalAuthIdentityRecord } from "../types";

export class ExternalAuthIdentitiesRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  create(identity: ExternalAuthIdentityRecord): ExternalAuthIdentityRecord {
    this.getStore().externalAuthIdentities.unshift(identity);
    return identity;
  }

  getByProviderAndSubject(
    provider: ExternalAuthIdentityRecord["provider"],
    subject: string,
  ): ExternalAuthIdentityRecord | null {
    const normalizedSubject = subject.trim();
    return (
      this.getStore().externalAuthIdentities.find(
        (identity) => identity.provider === provider && identity.subject === normalizedSubject,
      ) ?? null
    );
  }
}
