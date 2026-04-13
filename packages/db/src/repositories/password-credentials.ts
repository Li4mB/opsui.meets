import { getMemoryStore, type MemoryStoreAccessor } from "../store";
import type { UserPasswordCredentialRecord } from "../types";

export class PasswordCredentialsRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  upsert(credential: UserPasswordCredentialRecord): UserPasswordCredentialRecord {
    const store = this.getStore();
    const existingIndex = store.userPasswordCredentials.findIndex(
      (entry) => entry.userId === credential.userId,
    );

    if (existingIndex >= 0) {
      store.userPasswordCredentials[existingIndex] = credential;
      return credential;
    }

    store.userPasswordCredentials.unshift(credential);
    return credential;
  }

  getByUserId(userId: string): UserPasswordCredentialRecord | null {
    return this.getStore().userPasswordCredentials.find((credential) => credential.userId === userId) ?? null;
  }
}
