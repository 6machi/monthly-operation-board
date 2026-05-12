import { supabase } from './supabase-client.js?v=44';

export async function loadTasks(teamId){
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('team_id', teamId)
    .order('sort_order', { ascending:true })
    .order('created_at', { ascending:false });
  if(error) throw error;
  return data || [];
}
export async function createTask(payload){
  const { data, error } = await supabase.from('tasks').insert(payload).select('*').single();
  if(error) throw error;
  return data;
}
export async function updateTask(id, patch){
  const { data, error } = await supabase.from('tasks').update(patch).eq('id', id).select('*').single();
  if(error) throw error;
  return data;
}
export async function deleteTask(id){
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if(error) throw error;
}
export async function markCarryover(id, carryDate){
  return updateTask(id, { carryover_date: carryDate, schedule_date: null, status:'carryover', sort_order: Date.now() * -1 });
}
export async function returnToSchedule(id, scheduleDate){
  return updateTask(id, { schedule_date: scheduleDate, carryover_date: null, status:'scheduled', sort_order: Date.now() * -1 });
}
