"""Public-page evidence collection using the host's existing verified TLS trust."""
from html.parser import HTMLParser
from urllib.request import Request, urlopen
from urllib.parse import urljoin, urlsplit
import concurrent.futures, json, pathlib, datetime

class Page(HTMLParser):
    def __init__(self):
        super().__init__(); self.text=[]; self.links=[]; self.skip=0; self.link=None; self.tags=[]; self.forms=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag in ('script','style','noscript'): self.skip+=1
        if tag=='a': self.link={'href':a.get('href',''),'text':''}
        if tag=='html': self.tags.append({'dir':a.get('dir'),'lang':a.get('lang')})
        if tag in ('input','form','button'): self.forms.append({k:v for k,v in a.items() if k in ('name','type','action','aria-label','placeholder')})
        if tag in ('p','div','h1','h2','h3','li','br','section'): self.text.append('\n')
    def handle_endtag(self,tag):
        if tag in ('script','style','noscript'): self.skip=max(0,self.skip-1)
        if tag=='a' and self.link: self.links.append(self.link); self.link=None
    def handle_data(self,data):
        if not self.skip:
            self.text.append(data)
            if self.link:self.link['text']+=data

def fetch(url):
    result={'url':url,'at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:
        response=urlopen(Request(url,headers={'User-Agent':'Mozilla/5.0 public-product-research'}),timeout=20)
        html=response.read(3_000_000).decode('utf-8',errors='replace'); p=Page();p.feed(html)
        result.update(status=response.status,final=response.url,text='\n'.join(x.strip() for x in ''.join(p.text).splitlines() if x.strip()),links=[{'url':urljoin(response.url,x['href']),'label':x['text'].strip()} for x in p.links if x['href']],html_attributes=p.tags,forms=p.forms)
    except Exception as e: result['error']=str(e)
    return result

roots=['https://jawabha.ae/','https://seenjeemkw.com/','https://www.asbghm.com/','https://befateen.com/','https://jam3aa.com/','https://seenso2al.com/']
results=list(concurrent.futures.ThreadPoolExecutor(max_workers=6).map(fetch,roots))
root=pathlib.Path('.local/research');root.mkdir(parents=True,exist_ok=True)
(root/'http-roots.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
for i,r in enumerate(results):
    print('\nSITE',i+1,r['url'],'STATUS',r.get('status',r.get('error')))
    print(r.get('text','')[:18000]);print('LINKS',json.dumps(r.get('links',[]),ensure_ascii=False)[:15000])
