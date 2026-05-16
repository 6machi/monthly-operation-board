import { supabase } from './supabase-client.js?v=65';

export async function getSession(){
  const { data, error } = await supabase.auth.getSession();
  if(error) throw error;
  return data.session;
}
export async function signIn(email,password){
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if(error) throw error;
  return data.session;
}
export async function signUp(email,password){
  const { data, error } = await supabase.auth.signUp({ email, password });
  if(error) throw error;
  return data.session;
}
export async function signOut(){
  const { error } = await supabase.auth.signOut();
  if(error) throw error;
}
export async function ensureProfileAndTeam(user){
  const { error:bootErr } = await supabase.rpc('bootstrap_my_board');
  if(bootErr) throw bootErr;

  const { data:memberships, error:memberErr } = await supabase
    .from('team_members')
    .select('team_id, role, teams(id,name,created_by)')
    .eq('user_id', user.id)
    .limit(1);
  if(memberErr) throw memberErr;
  if(!memberships || !memberships.length) throw new Error('ボード情報を作成できませんでした');

  const team = memberships[0].teams;
  const { data:profile, error:profileErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  if(profileErr) throw profileErr;
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
  const { data, error } = await supabase
    .from('profiles')
    .update(payload)
    .eq('id', (await supabase.auth.getUser()).data.user.id)
    .select('*')
    .single();
  if(error) throw error;
  return data;
}
