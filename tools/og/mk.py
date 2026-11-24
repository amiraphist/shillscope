# builds t/<id>/index.html + og.jpg (X link preview for a shill thread)
import json,sys,io,os,html,urllib.request
from PIL import Image,ImageDraw,ImageFont,ImageOps
tid=sys.argv[1]
assert tid.isdigit() and 5<=len(tid)<=25
D=os.path.dirname(os.path.abspath(__file__))
UA={'User-Agent':'shillscope-og'}
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=40).read()
j=json.loads(get(f"https://shillscope.amiraphist.workers.dev/api/replies?id={tid}"))
items=[i for i in j.get('items',[]) if any(m.get('type')=='photo' for m in i.get('media',[]))]
if len(items)<3: print('too few art replies',len(items)); sys.exit(0)
seen=set();pick=[]
for i in sorted(items,key=lambda x:-x.get('likes',0)):
    a=i['author']['username']
    if a in seen: continue
    seen.add(a);pick.append(i)
    if len(pick)==6: break
total=j.get('total') or len(j['items'])
W,H=1200,630;BG=(10,10,10);RED=(226,40,46)
im=Image.new('RGB',(W,H),BG);d=ImageDraw.Draw(im)
G=D+'/SpaceGrotesk.ttf';M=D+'/JetBrainsMono.ttf'
def f(p,s,w=None):
    F=ImageFont.truetype(p,s)
    try:
        if w: F.set_variation_by_axes([w])
    except Exception: pass
    return F
gx,gw,gap=452,W-452,4
cw=(gw-2*gap)//3; ch=(H-gap)//2
k=0
for i in pick:
    m=[m for m in i['media'] if m['type']=='photo'][0]
    try: t=Image.open(io.BytesIO(get(m.get('thumb') or m['url']))).convert('RGB')
    except Exception: continue
    t=ImageOps.fit(t,(cw,ch),Image.LANCZOS)
    im.paste(t,(gx+(k%3)*(cw+gap),(k//3)*(ch+gap))); k+=1
L=56; lg=f(G,46,700); x=L
d.text((x,52),"shill",font=lg,fill=(240,240,240)); x+=d.textlength("shill",font=lg)
d.text((x,52),"scope",font=lg,fill=RED)
user=j['root']['author']['username']
d.text((L,200),"thread by",font=f(M,20),fill=(130,130,130))
uf=f(M,26)
while d.textlength('@'+user,font=uf)>380 and uf.size>14: uf=f(M,uf.size-2)
d.text((L,230),'@'+user,font=uf,fill=(235,235,235))
d.text((L,300),str(total),font=f(G,128 if len(str(total))<4 else 104,700),fill=RED)
d.text((L,450),"pieces in one gallery",font=f(M,22),fill=(235,235,235))
d.text((L,482),"live prices · for-sale filter",font=f(M,20),fill=(130,130,130))
d.text((L,560),"shillscope.art",font=f(M,20),fill=(130,130,130))
out=os.path.join('t',tid); os.makedirs(out,exist_ok=True)
im.save(out+'/og.jpg',quality=86)
u=html.escape(user)
open(out+'/index.html','w').write(f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>@{u} thread · shillscope</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:type" content="website">
<meta property="og:title" content="@{u} thread · every piece in one gallery">
<meta property="og:description" content="Every artwork reply in one gallery: live prices, for-sale filter, collect list.">
<meta property="og:url" content="https://shillscope.art/t/{tid}/">
<meta property="og:image" content="https://shillscope.art/t/{tid}/og.jpg">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@shillscope">
<meta name="twitter:image" content="https://shillscope.art/t/{tid}/og.jpg">
<link rel="icon" href="/favicon.svg">
<meta http-equiv="refresh" content="0;url=/?t={tid}">
<script>location.replace('/?t={tid}'+location.hash)</script>
<style>body{{background:#0a0a0a;color:#eee;font-family:monospace;display:grid;place-items:center;height:100vh;margin:0}}a{{color:#e2282e}}</style>
</head><body><a href="/?t={tid}">open gallery</a></body></html>
''')
print('built',tid,total,k)
