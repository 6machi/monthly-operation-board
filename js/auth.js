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
  const displayName = user.email?.split('@')[0] || '自分';
  await supabase.from('profiles').upsert({ id:user.id, display_name:displayName }, { onConflict:'id' });

  let { data:memberships, error:memberErr } = await supabase
    .from('team_members')
    .select('team_id, role, teams(id,name,created_by)')
    .eq('user_id', user.id)
    .limit(1);
  if(memberErr) throw memberErr;

  if(!memberships || !memberships.length){
    const { data:team, error:teamErr } = await supabase
      .from('teams')
      .insert({ name:'個人ボード', created_by:user.id })
      .select('*')
      .single();
    if(teamErr) throw teamErr;
    const { error:tmErr } = await supabase
      .from('team_members')
      .insert({ team_id:team.id, user_id:user.id, role:'admin' });
    if(tmErr) throw tmErr;
    memberships = [{ team_id:team.id, role:'admin', teams:team }];
  }

  const team = memberships[0].teams;
  const { data:profile } = await supabase.from('profiles').select('*').eq('id',user.id).single();
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
