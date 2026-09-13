import { Response } from "express";

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data?: T;
  timestamp: number;
}

export function success<T>(res: Response, data?: T, message = "success"): Response {
  const body: ApiResponse<T> = { code: 200, message, data, timestamp: Date.now() };
  return res.status(200).json(body);
}

export function created<T>(res: Response, data?: T, message = "created"): Response {
  const body: ApiResponse<T> = { code: 200, message, data, timestamp: Date.now() };
  return res.status(201).json(body);
}

export function fail(res: Response, code: number, message: string, httpStatus = 400): Response {
  const body: ApiResponse = { code, message, timestamp: Date.now() };
  return res.status(httpStatus).json(body);
}

export function notFound(res: Response, message = "资源不存在"): Response {
  return fail(res, 404, message, 404);
}

export function unauthorized(res: Response, message = "未认证"): Response {
  return fail(res, 401, message, 401);
}

export function forbidden(res: Response, message = "无权限"): Response {
  return fail(res, 403, message, 403);
}

export function serverError(res: Response, message = "服务器错误"): Response {
  return fail(res, 500, message, 500);
}