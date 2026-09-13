import { Request, Response, NextFunction } from "express";
import { serverError } from "../utils/response";

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  console.error("[Error]", err);
  return serverError(res, err.message || "服务器错误");
}

export function notFoundHandler(_req: Request, res: Response) {
  return serverError(res, "接口不存在");
}