import { supabase } from './supabase-client.js?v=104';

function cleanEmail(email){ return String(email || '').trim(); }
function cleanPassword(password){ return String(password || ''); }

export async function getSession(){
  const { data, error } = await supabase.auth.getSession();
  if(error) throw error;
  if(data?.session) return data.session;
  // ブラウザ側の状態が中途半端な時の保険。
  const userRes = await supabase.auth.getUser();
  if(userRes?.data?.user) return { user:userRes.data.user };
  return null;
}
export async function signIn(email,password){
  const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail(email), password: cleanPassword(password) });
  if(error) throw error;
  return data.session;
}
export async function signUp(email,password){
  const { data, error } = await supabase.auth.signUp({ email: cleanEmail(email), password: cleanPassword(password) });
  if(error) throw error;
  return data.session;
}
export async function signOut(){
  const { error } = await supabase.auth.signOut();
  if(error) throw error;
}
export async function resetAuthSession(){
  try{ await supabase.auth.signOut({ scope:'local' }); }
  catch(e){ console.warn('local signOut skipped', e); }
  try{
    Object.keys(localStorage || {}).forEach(k=>{
      if(String(k).includes('supabase') || String(k).includes('sb-')) localStorage.removeItem(k);
    });
  }catch(e){ console.warn('localStorage cleanup skipped', e); }
}

async function maybeSingle(q){
  const { data, error } = await q.maybeSingle();
  if(error) throw error;
  return data;
}

async function ensureProfileFallback(user){
  const defaults = {
    id: user.id,
    display_name: user.user_metadata?.display_name || user.email?.split('@')?.[0] || '自分',
    display_emoji: '🌙',
    display_color: '#5d9cec',
    sleep_start_time: '02:00',
    sleep_end_time: '09:00',
    work_enabled: false,
    work_start_time: '10:00',
    work_end_time: '19:00',
    work_days: [1,2,3,4,5],
    work_category: '仕事'
  };
  let existing = null;
  try{
    existing = await maybeSingle(supabase.from('profiles').select('*').eq('id', user.id));
  }catch(e){ console.warn('profile select failed', e); }
  if(existing) return existing;
  try{
    const { data, error } = await supabase.from('profiles').upsert(defaults, { onConflict:'id' }).select('*').single();
    if(error) throw error;
    return data;
  }catch(e){
    console.warn('profile fallback upsert failed', e);
    return defaults;
  }
}

async function ensureTeamFallback(user){
  let membership = null;
  try{
    const rows = await supabase
      .from('team_members')
      .select('team_id, role, teams(id,name,created_by)')
      .eq('user_id', user.id)
      .limit(1);
    if(rows.error) throw rows.error;
    membership = rows.data?.[0] || null;
  }catch(e){ console.warn('membership select failed', e); }
  if(membership?.teams) return membership.teams;

  let team = null;
  try{
    team = await maybeSingle(supabase.from('teams').select('*').eq('created_by', user.id).limit(1));
  }catch(e){ console.warn('team select by owner failed', e); }
  if(!team){
    const payload = { name:'個人ボード', created_by:user.id };
    const { data, error } = await supabase.from('teams').insert(payload).select('*').single();
    if(error) throw error;
    team = data;
  }
  try{
    const { error } = await supabase
      .from('team_members')
      .upsert({ team_id:team.id, user_id:user.id, role:'owner' }, { onConflict:'team_id,user_id' });
    if(error) throw error;
  }catch(e){ console.warn('team member fallback upsert failed', e); }
  return team;
}

export async function ensureProfileAndTeam(user){
  if(!user?.id) throw new Error('ログイン情報を取得できませんでした。もう一度ログインしてください。');

  // 既存SQLが入っている環境ではRPCを最優先。失敗しても画面を落とさず、下の手動復旧へ進む。
  try{
    const { error:bootErr } = await supabase.rpc('bootstrap_my_board');
    if(bootErr) console.warn('bootstrap_my_board skipped:', bootErr.message || bootErr);
  }catch(e){ console.warn('bootstrap_my_board unavailable:', e); }

  const profile = await ensureProfileFallback(user);
  const team = await ensureTeamFallback(user);
  if(!team?.id) throw new Error('ボード情報を作成できませんでした。SupabaseのSQL/RLS設定を確認してください。');
  return { profile, team };
}
export async function loadMembers(teamId){
  const { data, error } = await supabase
    .from('team_members')
    .select('user_id, role, profiles(id, display_name, display_emoji, display_color, sleep_start_time, sleep_end_time, work_enabled, work_start_time, work_end_time, work_days, work_category)')
    .eq('team_id', teamId)
    .order('created_at', { ascending:true });
  if(error) throw error;
  return (data || []).map(row => ({
    id: row.user_id,
    role: row.role,
    name: row.profiles?.display_name || 'メンバー',
    emoji: row.profiles?.display_emoji || '🌙',
    color: row.profiles?.display_color || '#5d9cec',
    sleepStart: String(row.profiles?.sleep_start_time || '02:00').slice(0,5),
    sleepEnd: String(row.profiles?.sleep_end_time || '09:00').slice(0,5),
    workEnabled: !!row.profiles?.work_enabled,
    workStart: String(row.profiles?.work_start_time || '10:00').slice(0,5),
    workEnd: String(row.profiles?.work_end_time || '19:00').slice(0,5),
    workDays: Array.isArray(row.profiles?.work_days) ? row.profiles.work_days : [1,2,3,4,5],
    workCategory: row.profiles?.work_category || '仕事'
  }));
}
export async function updateMyProfile(profile){
  const payload = {
    display_name: (profile.display_name || '').trim() || '自分',
    display_emoji: (profile.display_emoji || '🌙').trim().slice(0, 4) || '🌙',
    display_color: profile.display_color || '#5d9cec',
    sleep_start_time: profile.sleep_start_time || '02:00',
    sleep_end_time: profile.sleep_end_time || '09:00',
    work_enabled: !!profile.work_enabled,
    work_start_time: profile.work_start_time || '10:00',
    work_end_time: profile.work_end_time || '19:00',
    work_days: Array.isArray(profile.work_days) ? profile.work_days : [1,2,3,4,5],
    work_category: profile.work_category || '仕事'
  };
  const userRes = await supabase.auth.getUser();
  const user = userRes?.data?.user;
  if(!user?.id) throw new Error('ログイン情報を取得できませんでした。もう一度ログインしてください。');
  const { data, error } = await supabase
    .from('profiles')
    .update(payload)
    .eq('id', user.id)
    .select('*')
    .single();
  if(error) throw error;
  return data;
}
