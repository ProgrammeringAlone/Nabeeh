"""Build through the existing cloud proxy without storing proxy values in image layers."""
import os, socket, subprocess, urllib.parse, pathlib
root=pathlib.Path(__file__).resolve().parent.parent
config=root/'.local/docker';config.mkdir(parents=True,exist_ok=True)
args=['docker','--config',str(config),'build','--network','host']
proxy=os.environ.get('HTTPS_PROXY')
if proxy:
    parsed=urllib.parse.urlsplit(proxy)
    # Resolve the actual environment proxy; do not substitute external site destinations.
    address=socket.gethostbyname(parsed.hostname)
    args+=['--add-host',parsed.hostname+':'+address,'--secret','id=build_proxy,env=HTTPS_PROXY']
ca='/usr/local/share/ca-certificates/environment-proxy-ca.crt'
if os.path.exists(ca):args+=['--secret','id=build_ca,src='+ca]
args+=['-t','nabeeh:development-check','.']
raise SystemExit(subprocess.call(args,cwd=root))
