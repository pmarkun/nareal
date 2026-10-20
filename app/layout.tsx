import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Na Real · Checagem ao vivo',description:'Acompanhe as checagens do debate, com afirmações, fontes e revisão humana.',icons:{icon:'/favicon.svg'}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
