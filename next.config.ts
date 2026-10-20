import type {NextConfig} from 'next';
const config:NextConfig={output:'standalone',poweredByHeader:false,experimental:{serverActions:{bodySizeLimit:'2mb'}}};
export default config;
