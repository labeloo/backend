export type UserLogin = {
    email?: string;
    password?: string;
}

export type payloadType = {
    userId: number;
    email: string;
    isPlatformAdmin?: boolean;
    exp: number;
};