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
  // 初回ログイン時のプロフィール・個人ボード作成は、RLSで弾かれないよう
  // Supabase側の SECURITY DEFINER 関数に任せます。
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
    .select('user_id, role, profiles(id, display_name)')
    .eq('team_id', teamId)
    .order('created_at', { ascending:true });
  if(error) throw error;
  return (data || []).map(row => ({
    id: row.user_id,
    role: row.role,
    name: row.profiles?.display_name || 'メンバー'
  }));
}
