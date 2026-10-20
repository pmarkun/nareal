import {createHash} from 'node:crypto';
export function isSameOrigin(request:Request){if(request.headers.get('sec-fetch-site')==='cross-site')return false;const origin=request.headers.get('origin');if(!origin)return false;try{return new URL(origin).origin===new URL(process.env.APP_URL||request.url).origin;}catch{return false;}}
export function secureCookies(){return Boolean(process.env.APP_URL?.startsWith('https://'));}
export function requestKey(request:Request){const trustProxy=process.env.TRUST_PROXY==='true'||Boolean(process.env.RAILWAY_ENVIRONMENT_ID);const address=trustProxy?request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim():undefined;return createHash('sha256').update(address||'shared-local-client').digest('hex');}
