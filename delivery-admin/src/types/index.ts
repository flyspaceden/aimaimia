export interface LoginRequest {
  username: string;
  password: string;
  captchaId: string;
  captchaCode: string;
}

export interface LoginByPhoneCodeRequest {
  phone: string;
  code: string;
}

export interface CaptchaResponse {
  captchaId: string;
  svg: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  admin: {
    id: string;
    username: string;
    realName: string | null;
    roles: string[];
  };
}

export interface AdminProfile {
  id: string;
  username: string;
  realName: string | null;
  phone?: string | null;
  roles: string[];
  permissions: string[];
}
