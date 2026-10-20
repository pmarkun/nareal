import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Na Real · Checagem ao vivo',description:'A fala passa. A checagem fica. Vídeo, evidências e revisão editorial em um só lugar.',icons:{icon:'/favicon.svg'}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
