#!/usr/bin/env python3
"""Private ARGUS briefing; default is preview. Sending requires --send."""
import argparse, collections, datetime as dt, fcntl, html, json, os, pathlib, urllib.request, urllib.error
ROOT = pathlib.Path(__file__).resolve().parents[1]
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

def read(path, default=None):
    try: return json.loads(path.read_text())
    except (OSError, ValueError): return {} if default is None else default

def stamp(value):
    try: return dt.datetime.fromisoformat(str(value).replace('Z', '+00:00')).astimezone(IST)
    except (ValueError, TypeError): return None

def age(value, now):
    t = stamp(value)
    return (now-t).total_seconds() if t else None

def env():
    result = {}
    for line in (ROOT/'.env').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k,v=line.split('=',1);result[k.strip()]=v.strip().strip('\"\'')
    result.update(os.environ)
    return result

def atomic(path, data):
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2));tmp.chmod(0o600);tmp.replace(path)

def build(vault, now):
    system=vault/'system';m=read(system/'metrics/marketing-latest.json');c=read(system/'creative-intelligence/latest.json');s=read(system/'sales-reconciliation/latest-check.json')
    sections=[]
    def add(title, lines): sections.append((title, lines or ['No verified data available.']))
    currency=m.get('currency') or 'Currency unknown'
    def money(x): return f'{currency} {x:,.2f}' if isinstance(x,(int,float)) else 'Unavailable'
    add('Your attention today', [str(f.get('text','')) for f in m.get('flags',[])][:5])
    changes=[]
    for path in (system/'argus-changes').glob('*.json'):
        change=read(path);elapsed=age(change.get('completed_at'),now)
        if change.get('status')=='verified' and change.get('evidence') and elapsed is not None and 0<=elapsed<=86400:
            changes.append(change)
    add('Changes made in ARGUS', [str(x.get('summary','')) for x in sorted(changes,key=lambda x:x['completed_at'],reverse=True)] or ['No verified product changes recorded in the last 24 hours. Workflow runs are reported separately below.'])
    lines=['These are ad-platform attributed results, not reconciled cash sales.', 'Snapshot generated: '+str(m.get('generated_at','unavailable'))]
    for name,ch in m.get('channels',{}).items():
        if name not in ('meta','google'): continue
        w=ch.get('window') or {};t=ch.get('totals') or {};curr=ch.get('currency','unknown currency')
        lines.append(f"{name.upper()} | {w.get('from','?')} to {w.get('to','?')} | {ch.get('status','unknown')} | Spend {curr} {t.get('spend','unavailable')} | Attributed revenue {curr} {t.get('revenue','unavailable')} | ROAS {t.get('roas','unavailable')} | Results {t.get('results','unavailable')}")
        if 'accounts_total' in ch: lines.append(f"Account coverage: {ch.get('accounts_ok',0)}/{ch['accounts_total']}.")
        lines.append(name.upper()+' diagnostics: '+'; '.join(k.replace('_',' ')+' '+str(v) for k,v in t.items() if v is not None and k not in ('spend','revenue','roas','results')))
        for campaign in (ch.get('campaigns') or [])[:5]:
            lines.append(f"Campaign {campaign.get('name','unnamed')}: {campaign.get('verdict','unavailable')} — {campaign.get('reason','No recorded recommendation')}")
    p=m.get('pacing',{})
    lines += [f"MTD ({p.get('month','?')}): spend {money(p.get('spend_mtd'))}; attributed revenue {money(p.get('revenue_mtd'))}; ROAS {p.get('blended_roas_mtd','unavailable')}.",f"Budget {money(p.get('budget'))}; pace {p.get('pace_pct','unavailable')}%; projected month-end spend {money(p.get('projected_eom'))}.",f"Modelled contribution MTD {money(p.get('contribution_mtd'))}; uses configured margin assumptions, not accounting profit."]
    add('Paid performance and budget',lines)
    blended=m.get('blended') or {}
    add('Blended performance and economics', [label+': '+'; '.join(k.replace('_',' ')+' '+str(v) for k,v in (blended.get(key) or {}).items()) for key,label in [('totals','Current reporting window'),('prev_totals','Previous reporting window'),('economics','Modelled economics (configured margins; not accounting profit)')] if blended.get(key)])
    lines=[f"Latest sales observation: {s.get('observed_at','unavailable')}. This is the latest saved check, not necessarily yesterday's sales."]
    for name,source in s.get('sources',{}).items():
        period=source.get('period',{})
        lines.append(f"{name.title()} | {period.get('from','?')} to {period.get('to','?')} | {source.get('count','?')} {source.get('count_basis','records')} | {source.get('currency') or 'Currency unverified'} {source.get('amount','unavailable')}")
    comparison=s.get('comparison',{})
    lines += [f"Reconciliation: {comparison.get('status','unavailable')}. Transaction matching: {s.get('transaction_matching',comparison.get('transaction_match_status','unavailable'))}.", 'Open checks: '+', '.join(comparison.get('blockers',[]) or ['See latest reconciliation report.'])]
    add('Sales and reconciliation',lines)
    ads=c.get('ads',[]);ready=[a for a in ads if a.get('analysis',{}).get('status')=='ready']
    lines=[f"Snapshot: {c.get('generated_at','unavailable')}; window {c.get('windows',{}).get('current',{}).get('from','?')} to {c.get('windows',{}).get('current',{}).get('to','?')}. {len(ads)} ads loaded; {len(ready)} assessed.", 'Observational comparisons use each campaign objective. Poster-only assessments do not evaluate video motion, audio or opening hooks.']
    leaders=[a for a in ads if a.get('performance',{}).get('status')=='leading'][:3]
    for a in leaders: lines.append(f"Leading within its peer group: {a.get('name')} — {a.get('metric',{}).get('label')}: {round(a.get('performance',{}).get('value') or 0,2)}; hook {a.get('analysis',{}).get('hook_type','unknown')}; offer {a.get('analysis',{}).get('offer_type','unknown')}.")
    fatigue=[a for a in ads if a.get('fatigue',{}).get('status') not in (None,'stable','insufficient_data','insufficient')]
    for a in fatigue[:3]: lines.append(f"Review fatigue: {a.get('name')} — {a.get('fatigue',{}).get('status')}; {'; '.join(a.get('fatigue',{}).get('reasons',[])[:2])}")
    add('Creative intelligence',lines)
    runs=[]
    for path in (system/'runs').glob('*.json'):
        r=read(path);a=age(r.get('ts_completed') or r.get('ts_started') or r.get('ts_queued'),now)
        if a is not None and 0<=a<=86400:runs.append(r)
    counts=collections.Counter(r.get('status','unknown') for r in runs)
    lines=[f"Last 24 hours: {len(runs)} recorded runs. Status counts: {', '.join(str(v)+' '+k for k,v in counts.items()) or 'none'}."]
    for r in sorted(runs,key=lambda x:x.get('ts_completed') or x.get('ts_started') or '',reverse=True)[:8]:
        lines.append(f"{r.get('skill','Workflow')}: {r.get('status','unknown')} at {r.get('ts_completed') or r.get('ts_started') or r.get('ts_queued')}")
    runner=read(system/'runner-status.json');a=age(runner.get('ts'),now)
    lines.append(f"Runner: {'heartbeat stale/unavailable' if a is None or a>120 else 'responding'}; active {runner.get('active','?')}, queued {runner.get('pending','?')}.")
    add('ARGUS activity',lines)
    lines=[]
    for source in m.get('pull',{}).get('sources',[]):
        a=age(source.get('ts'),now);status=source.get('status','unknown')
        if a is None or a<0: status='timestamp unavailable/invalid'
        elif status in ('ok','partial') and a>m.get('pull',{}).get('max_age_s',46800):status='stale ('+status+')'
        lines.append(f"{source.get('source')}: {status}; checked {source.get('ts','unknown')}. {source.get('error','')}")
    for name in ['instagram','aeo']:
        data=m.get(name,{})
        if data: lines.append(name.upper()+': '+'; '.join(k.replace('_',' ')+' '+str(v) for k,v in data.items() if v is not None))
    seo=m.get('channels',{}).get('seo') or {}
    lines.append('SEO: '+str(seo.get('status','unavailable'))+'; reporting window '+str(seo.get('window') or 'unavailable')+'; metrics '+str(seo.get('totals') or 'unavailable'))
    add('Source health, social and search',lines)
    title='ARGUS morning briefing · '+now.date().isoformat()
    text=title+'\nPrepared '+now.strftime('%d %b %Y, %H:%M IST')+'\n\n'+'\n\n'.join(t+'\n'+'\n'.join('• '+str(x) for x in lines) for t,lines in sections)
    blocks=''.join('<h2 style="font-size:18px;color:#30304b;margin-top:30px">'+html.escape(t)+'</h2><ul>'+''.join('<li style="margin:10px 0;line-height:1.6">'+html.escape(str(x))+'</li>' for x in lines)+'</ul>' for t,lines in sections)
    markup='<!doctype html><html><body style="margin:0;background:#f6f3ef;color:#343442;font-family:Arial,sans-serif"><div style="max-width:680px;margin:auto;padding:32px 24px;background:white"><p style="color:#ee7759;letter-spacing:5px;font-weight:bold">ARGUS</p><h1 style="font-size:28px">Your morning command briefing</h1><p>'+html.escape(now.strftime('%A, %d %B %Y · %H:%M IST'))+'</p>'+blocks+'<p style="margin-top:30px;color:#777">Private briefing for Rishi · Figures retain their source reporting periods.</p></div></body></html>'
    return title,text,markup

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--send',action='store_true');args=parser.parse_args()
    e=env();vault=pathlib.Path(read(ROOT/'.argus-config.json')['vault']);now=dt.datetime.now(IST)
    out=vault/'system/email-digests';out.mkdir(parents=True,exist_ok=True);out.chmod(0o700)
    title,text,markup=build(vault,now)
    (out/'preview.html').write_text(markup);(out/'preview.txt').write_text(text)
    if not args.send: print('Preview: '+str(out/'preview.html'));return
    key=e.get('RESEND_API_KEY');sender=e.get('ARGUS_DIGEST_FROM');recipient=e.get('ARGUS_DIGEST_TO')
    if not key or not sender: raise SystemExit('Email blocked: configure RESEND_API_KEY and verified ARGUS_DIGEST_FROM in .env.')
    if recipient!='rishi@echovme.com':raise SystemExit('Recipient differs from the authorized briefing recipient.')
    day=now.date().isoformat();path=out/(day+'.json')
    with (out/'send.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX);state=read(path)
        if state.get('id'): print('Already accepted by Resend for '+day);return
        if state and (age(state.get('created_at'),now) or 0)>23*3600:raise SystemExit('Uncertain old send requires review; refusing duplicate beyond idempotency window.')
        if not state:
            state={'created_at':now.isoformat(),'key':'argus-morning-'+day,'payload':{'from':sender,'to':[recipient],'subject':title,'html':markup,'text':text}};atomic(path,state)
        req=urllib.request.Request('https://api.resend.com/emails',data=json.dumps(state['payload']).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':state['key'],'User-Agent':'ARGUS/1.0'},method='POST')
        try:
            with urllib.request.urlopen(req,timeout=30) as response: result=json.load(response)
        except urllib.error.HTTPError as error:
            state['last_http_status']=error.code;atomic(path,state)
            # Never print payloads, keys or raw remote errors.
            raise SystemExit('Resend rejected send: HTTP '+str(error.code)+'. Check sender verification and key permissions.')
        if not result.get('id'):raise SystemExit('Resend response missing email ID; retained pending request for safe retry.')
        state.update(id=result['id'],accepted_at=now.isoformat());atomic(path,state);print('Resend accepted email '+result['id'])

if __name__=='__main__':main()
