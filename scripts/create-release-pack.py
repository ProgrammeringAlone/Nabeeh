"""Generate first-party puzzles and media. Requires ffmpeg; never approves content."""
import hashlib, json, math, pathlib, struct, subprocess, uuid, wave
root = pathlib.Path(__file__).resolve().parent.parent
bundle = root / 'media' / 'bundle'
bundle.mkdir(parents=True, exist_ok=True)
assets, questions = [], []
categories = [
 ('visual','عينك على التفاصيل','تحدّيات بصرية أصلية، من الأشكال إلى الأنماط.','◇'),
 ('rhythm','اسمع وعدّ','إشارات صوتية أصلية مع بديل نصّي.','♫'),
 ('motion','لاحظ الحركة','مقاطع قصيرة أصلية تختبر الانتباه.','▷'),
 ('ordering','رتّبها','بطاقات وأرقام تحتاج ترتيبًا واضحًا.','↕'),
 ('word','حروف مبعثرة','تحدّيات كلمات عربية أصلية.','ب'),
]
def identifier(key): return str(uuid.uuid5(uuid.NAMESPACE_URL, 'nabeeh:release:v1:'+key))
def base(category,i,text,answer,fact,subject,predicate,hint,explanation):
 return dict(text=text,answer=answer,explanation=explanation,hint=hint,
  factKey=f'release-v1:{category}:{subject}',subject=subject,predicate=predicate,fact=fact,
  categoryIds=[category],difficulty=['easy','easy','medium','medium','hard','hard'][i],
  format='text',region='all',tags=['أصلي','عائلي'],deterministic=True,
  provenance='Original Nabeeh release pack v1. Human review required; not auto-approved.')
def asset(category,i,extension,mime,content=None):
 aid=identifier(f'{category}:{i}')
 path=bundle/(aid+'.'+extension)
 if content is not None: path.write_bytes(content)
 return aid,path,mime
def finish_asset(aid,path,mime):
 data=path.read_bytes()
 assets.append(dict(id=aid,mime=mime,objectKey=path.name,sizeBytes=len(data),sha256=hashlib.sha256(data).hexdigest(),credit='Nabeeh original procedural artwork and recordings',license='Nabeeh first-party content; platform use only. All rights reserved.',source='https://github.com/ProgrammeringAlone/Nabeeh/blob/nabeeh-launch/media/README.md'))
for i,n in enumerate([3,5,7,9,11,13]):
 shape='circle' if i%2==0 else 'rect'
 shapes=[]
 for j in range(n):
  x,y=70+(j%5)*105,65+(j//5)*105
  if shape=='circle': shapes.append(f'<circle cx="{x}" cy="{y}" r="28" fill="#245844"/>')
  else: shapes.append(f'<rect x="{x-28}" y="{y-28}" width="56" height="56" rx="5" fill="#bb8734"/>')
 # The alt text conveys shapes, not their count. A text alternative supports nonvisual play.
 svg='<svg xmlns="http://www.w3.org/2000/svg" width="560" height="350" viewBox="0 0 560 350"><rect width="560" height="350" rx="24" fill="#f3efe1"/>'+''.join(shapes)+'</svg>'
 aid,path,mime=asset('visual',i,'svg','image/svg+xml',svg.encode());finish_asset(aid,path,mime)
 noun='الدوائر الخضراء' if shape=='circle' else 'المربعات الذهبية'
 q=base('visual',i,f'كم عدد {noun} في هذه اللوحة؟',str(n),f'{n}+0={n}',f'original-grid:{shape}:{n}','count-shapes','عدّ صفًا واحدًا ثم انتقل إلى التالي.',f'تحتوي اللوحة الأصلية على {n} أشكال من النوع المطلوب.')
 q.update(format='image',media=dict(assetId=aid,alt='لوحة من أشكال هندسية موزّعة على صفوف.',transcript='الأشكال في صفوف: '+ ' / '.join(' '.join('●' if shape=='circle' else '■' for _ in range(min(5,n-k))) for k in range(0,n,5))))
 questions.append(q)
for i,n in enumerate([2,3,4,5,6,7]):
 aid,path,mime=asset('rhythm',i,'wav','audio/wav')
 sample_rate=16000; duration=n*.5+.5
 with wave.open(str(path),'wb') as out:
  out.setparams((1,2,sample_rate,0,'NONE','not compressed'))
  data=[]
  for t in range(int(duration*sample_rate)):
   time=t/sample_rate; phase=(time-.25)% .5
   active=.25<=time<.25+n*.5 and phase<.14
   amplitude=.5*math.sin(2*math.pi*660*time)*math.sin(math.pi*phase/.14) if active else 0
   data.append(struct.pack('<h',int(amplitude*32767)))
  out.writeframes(b''.join(data))
 finish_asset(aid,path,mime)
 q=base('rhythm',i,'استمع إلى الإشارة: كم نغمة قصيرة تسمع؟',str(n),f'{n}+0={n}',f'original-tone-sequence:{n}','count-tones','يمكنك إعادة تشغيل المقطع.',f'تتكرّر النغمة القصيرة {n} مرات، وبينها فواصل صامتة.')
 q.update(format='audio',media=dict(assetId=aid,alt='مقطع من نغمات قصيرة متباعدة.',transcript=' '.join(['طن']*n)))
 questions.append(q)
for i,n in enumerate([2,3,4,5,6,7]):
 aid,path,mime=asset('motion',i,'mp4','video/mp4')
 duration=n*.6+.6
 enable='+'.join(f'between(t,{.3+j*.6:.2f},{.55+j*.6:.2f})' for j in range(n))
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i',f'color=c=0xf3efe1:s=560x350:d={duration}:r=24','-vf',f"drawbox=x=220:y=115:w=120:h=120:color=0x245844:t=fill:enable='{enable}'",'-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',str(path)],check=True)
 finish_asset(aid,path,mime)
 q=base('motion',i,'شاهد المقطع: كم مرة يظهر المربع الأخضر ثم يختفي؟',str(n),f'{n}+0={n}',f'original-flash-sequence:{n}','count-flashes','لاحظ كل ظهور جديد للمربع.',f'يظهر المربع الأخضر ويختفي {n} مرات في هذا المقطع الأصلي.')
 q.update(format='video',media=dict(assetId=aid,alt='مربع أخضر يظهر على خلفية فاتحة ثم يختفي.',transcript=' → '.join(['■ ثم فراغ']*n)))
 questions.append(q)
for i,values in enumerate([[12,3,8],[31,7,18],[64,22,45,9],[95,41,13,70],[108,57,93,24,76],[315,82,204,129,46]]):
 descending=i%2==1
 ordered=list(map(str,sorted(values,reverse=descending)))
 direction='descending' if descending else 'ascending'
 q=base('ordering',i,'رتّب الأعداد من '+('الأكبر إلى الأصغر.' if descending else 'الأصغر إلى الأكبر.'),'، '.join(ordered),direction+':'+','.join(map(str,values))+'='+','.join(ordered),','.join(map(str,values)),direction,'قارن قيمة كل عدد بالأعداد الأخرى.','الترتيب الصحيح هو: '+'، '.join(ordered)+'.')
 q.update(format='ordering',options=list(map(str,values)),orderingAnswer=ordered);questions.append(q)
for i,(word,letters,clue) in enumerate([('بحر','ر ح ب','مسطح مائي واسع'),('قلم','م ق ل','أداة للكتابة'),('مكتبة','ت م ة ك ب','مكان لحفظ الكتب وقراءتها'),('حديقة','ق ح ة ي د','مكان أخضر للتنزّه'),('مفتاح','ت م ا ح ف','أداة لفتح القفل'),('طائرة','ئ ط ة ا ر','وسيلة نقل تحلّق في الجو')]):
 q=base('word',i,f'رتّب الحروف لتكوّن كلمة تدل على {clue}: {letters}',word,f'anagram:{letters}={word}',f'word-puzzle:{word}','assemble-word','استخدم كل حرف مرة واحدة.',f'بتجميع الحروف نحصل على «{word}»، وهي تدل على {clue}.')
 q['format']='word';questions.append(q)
for i,(a,b) in enumerate([(23,17),(48,29),(19,26),(34,19),(53,27),(71,38)]):
 op='+' if i%2==0 else '*'; answer=a+b if op=='+' else a*b
 q=base('logic',i,f'كم يساوي {a} '+('زائد' if op=='+' else 'ضرب')+f' {b}؟',str(answer),f'{a}{op}{b}={answer}',f'original-calculation:{a}{op}{b}','calculate','قسّم المسألة إلى خطوات بسيطة.',f'{a} {op} {b} = {answer}.');questions.append(q)
pack=dict(version=1,categories=[dict(id=c[0],name=c[1],description=c[2],icon=c[3],color='#dce9e4') for c in categories],assets=assets,questions=questions)
(root/'media'/'release-pack.json').write_text(json.dumps(pack,ensure_ascii=False,indent=2)+'\n')
lines=['# حزمة نبيه الأولى للمراجعة','',f'{len(questions)} مسودة أصلية؛ لا توجد موافقة تحريرية تلقائية.','', '| # | الفئة | النوع | الصعوبة | السؤال | الإجابة |','|---|---|---|---|---|---|']
for i,q in enumerate(questions,1): lines.append(f'| {i} | {q["categoryIds"][0]} | {q["format"]} | {q["difficulty"]} | {q["text"]} | {q["answer"]} |')
lines.extend(['','راجع كل سؤال: صحة الإجابة، وضوح اللغة، مستوى الصعوبة، التشابه، وصحة عدّ النغمات أو الأشكال أو مرات الظهور.','الصور والملفات الصوتية والمقاطع أُنشئت إجرائيًا لهذا المشروع، ولا تستخدم أعمالًا مقتبسة من المواقع المرجعية.','الوسائط ملكية نبيه الأصلية للاستخدام داخل المنصة؛ جميع الحقوق محفوظة. مراجعة الحزمة واعتمادها يتمّان من حساب محرّر في التطبيق.'])
(root/'docs'/'release-review.md').write_text('\n'.join(lines)+'\n')
print(f'Prepared {len(questions)} drafts and {len(assets)} original assets. No approvals performed.')
