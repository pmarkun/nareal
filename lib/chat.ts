import {z} from 'zod';
export const chatInput=z.object({name:z.string().trim().min(2).max(32).refine(s=>!/[\r\n\u0000-\u001f]/.test(s),'Nome inválido'),body:z.string().trim().min(1).max(600).refine(s=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s),'Mensagem inválida'),room:z.string().regex(/^[A-Za-z0-9_-]{11}$/)});
export type ChatMessage={id:number,room:string,name:string,body:string,createdAt:number};
