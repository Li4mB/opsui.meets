import { getMemoryStore, type MemoryStoreAccessor } from "../store";
import type { UserRecord } from "../types";

export class UsersRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  create(user: UserRecord): UserRecord {
    this.getStore().users.unshift(user);
    return user;
  }

  list(): UserRecord[] {
    return [...this.getStore().users];
  }

  getById(id: string): UserRecord | null {
    return this.getStore().users.find((user) => user.id === id) ?? null;
  }

  getByEmail(email: string): UserRecord | null {
    const normalizedEmail = email.trim().toLowerCase();
    return this.getStore().users.find((user) => user.email.toLowerCase() === normalizedEmail) ?? null;
  }

  getByUsername(username: string): UserRecord | null {
    return this.getByNormalizedUsername(username.trim().toLowerCase());
  }

  getByNormalizedUsername(usernameNormalized: string): UserRecord | null {
    const normalizedUsername = usernameNormalized.trim().toLowerCase();
    return (
      this.getStore().users.find((user) => user.usernameNormalized === normalizedUsername) ?? null
    );
  }
}
