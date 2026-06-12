import 'express';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        orgId: string;
        email: string;
        role: string;
      };
    }
  }
}

export {};
