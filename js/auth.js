import { supabase } from './supabase-client.js';

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
    .select('user_id, role, profiles(id, display_name, display_emoji, display_color)')
    .eq('team_id', teamId)
    .order('created_at', { ascending:true });
  if(error) throw error;
  return (data || []).map(row => ({
    id: row.user_id,
    role: row.role,
    name: row.profiles?.display_name || 'メンバー',
    emoji: row.profiles?.display_emoji || '🌙',
    color: row.profiles?.display_color || '#5d9cec'
  }));
}
export async function updateMyProfile(profile){
  const payload = {
    display_name: (profile.display_name || '').trim() || '自分',
    display_emoji: (profile.display_emoji || '🌙').trim().slice(0, 4) || '🌙',
    display_color: profile.display_color || '#5d9cec'
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
