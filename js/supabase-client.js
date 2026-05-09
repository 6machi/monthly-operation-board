import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export function isConfigured(){
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL.includes('supabase.co'));
}

export const supabase = isConfigured()
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
