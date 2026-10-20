import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readSession} from '../../lib/access';
import AdminWorkspace from '../admin-workspace';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export default async function Admin(){if(!await readSession(await headers()))redirect('/admin/login');return <AdminWorkspace/>;}
