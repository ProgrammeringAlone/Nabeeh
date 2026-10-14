import {transaction,AppError} from "./db.ts";
import {integerSetting} from "./config.ts";
export async function reserveSemanticBudget(cents:number) {
  await transaction(async db=>{
    const limit=integerSetting("GENERATION_DAILY_BUDGET_CENTS",200,0,100000);
    const {rows:[budget]}=await db.query("INSERT INTO generation_budget(day,reserved_cents) VALUES(current_date,$1) ON CONFLICT(day) DO UPDATE SET reserved_cents=generation_budget.reserved_cents+$1 RETURNING reserved_cents",[cents]);
    if(budget.reserved_cents>limit) throw new AppError(429,"CONTENT_BUDGET","ميزانية المحتوى اليومية لا تسمح بهذا الطلب.");
  });
}
