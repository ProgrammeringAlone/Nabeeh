import type pg from "pg";
import {randomUUID} from "node:crypto";
import {AppError} from "./db.ts";
type SelectionSettings={categoryIds:string[];questionsPerCategory:number;difficulty:string;region:string};
export async function allocateBoard(db:pg.PoolClient,profiles:string[],setup:SelectionSettings) {
  const slots=setup.categoryIds.flatMap(category=>Array.from({length:setup.questionsPerCategory},(_,n)=>({category,difficulty:setup.difficulty==="mixed"?["easy","medium","hard"][n%3]:setup.difficulty})));
  const candidates=new Map<string,string[]>();
  for(const slot of slots) {
    const key=slot.category+":"+slot.difficulty;if(candidates.has(key))continue;
    const pivot=randomUUID();
    const sql="SELECT q.id FROM questions q JOIN question_categories qc ON qc.question_id=q.id WHERE qc.category_id=$1 AND q.difficulty=$2 AND q.status='approved' AND ($3='all' OR q.region IN('all',$3)) AND ($5=false OR q.development_only=false) AND (q.expires_at IS NULL OR q.expires_at>now()) AND NOT EXISTS(SELECT 1 FROM exposures e WHERE e.question_id=q.id AND e.profile_id=ANY($4::uuid[])) AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.question_id=q.id AND r.profile_id=ANY($4::uuid[]))";
    const params=[slot.category,slot.difficulty,setup.region,profiles,process.env.NODE_ENV==="production",pivot,slots.length];
    let rows=(await db.query(sql+" AND q.id >= $6 ORDER BY q.id LIMIT $7 FOR SHARE OF q",params)).rows;
    if(rows.length<slots.length) rows.push(...(await db.query(sql+" AND q.id < $6 ORDER BY q.id LIMIT $7 FOR SHARE OF q",[...params.slice(0,6),slots.length-rows.length])).rows);
    candidates.set(key,rows.map(q=>q.id));
  }
  // At most total-board-size candidates per bucket suffice for a complete matching:
  // a larger bucket alone contains more choices than all other slots can consume.
  const owner=new Map<string,number>(),chosen:string[]=Array(slots.length);
  const assign=(index:number,visited:Set<string>):boolean=>{
    const slot=slots[index];
    for(const id of candidates.get(slot.category+":"+slot.difficulty) || []) {
      if(visited.has(id))continue;visited.add(id);
      const previous=owner.get(id);
      if(previous===undefined || assign(previous,visited)){owner.set(id,index);chosen[index]=id;return true;}
    }
    return false;
  };
  for(let i=0;i<slots.length;i++) if(!assign(i,new Set())) throw new AppError(409,"FRESH_POOL_EXHAUSTED","لا توجد أسئلة جديدة كافية لهذه الاختيارات. غيّر الفئات أو عدد الجولات؛ لن نكرّر أسئلة شاهدتها.");
  return slots.map((slot,i)=>({...slot,questionId:chosen[i]}));
}
