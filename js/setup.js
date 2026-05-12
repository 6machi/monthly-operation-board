import { supabase } from './supabase-client.js?v=40';
import { DEFAULT_TREE } from './utils.js?v=40';

export async function loadTree(teamId, ownerId){
  const { data, error } = await supabase
    .from('category_trees')
    .select('*')
    .eq('team_id', teamId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if(error) throw error;
  if(data) return { id:data.id, tree:data.tree || DEFAULT_TREE };
  const { data:created, error:createErr } = await supabase
    .from('category_trees')
    .insert({ team_id:teamId, owner_id:ownerId, tree:DEFAULT_TREE })
    .select('*')
    .single();
  if(createErr) throw createErr;
  return { id:created.id, tree:created.tree || DEFAULT_TREE };
}
export async function saveTree(rowId, tree){
  const { error } = await supabase.from('category_trees').update({ tree }).eq('id', rowId);
  if(error) throw error;
}
