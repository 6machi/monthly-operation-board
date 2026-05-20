import { todayISO, addDays } from './utils.js?v=83';
export const state = {
  session:null,
  user:null,
  profile:null,
  team:null,
  members:[],
  selectedMemberId:null,
  tasks:[],
  tree:[],
  treeRowId:null,
  selectedCategoryIndex:0,
  view:'calendar',
  scheduleDate:todayISO(),
  carryDate:addDays(todayISO(),1),
  calendarMonth:todayISO().slice(0,7),
  draggingTaskId:null
};
