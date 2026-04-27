import json, subprocess
ids = [
'2041238098894569666','2041178189746282651','2041408406708482408','2029514946640322593','2041525215264661672','2041351772908949986'
]
out={}
for tid in ids:
    proc=subprocess.run(['npx','--yes','@steipete/bird','read',tid,'--json'],cwd='/Users/minimac/projects/tweet-vault',capture_output=True,text=True)
    out[tid]={'exit':proc.returncode,'stdout':proc.stdout,'stderr':proc.stderr}
json.dump(out, open('/Users/minimac/projects/tweet-vault/.tmp-specific-reads.json','w'), indent=2)
print('done')
