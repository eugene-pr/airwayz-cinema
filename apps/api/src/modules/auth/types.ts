// The authenticated caller a service acts for (ARCHITECTURE §11).
export interface Actor {
  userId: string;
}

export interface User {
  id: string;
  email: string;
}

export interface UserWithPasswordHash extends User {
  passwordHash: string;
}
