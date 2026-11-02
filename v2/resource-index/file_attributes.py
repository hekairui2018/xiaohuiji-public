"""Literal filename/folder attributes; unmentioned properties stay unknown."""
import re
def attributes(name,folders=(),registered=None):
    text=name+' '+' '.join(folders);registered=registered or {}
    def find(pattern):return list(dict.fromkeys(re.findall(pattern,text,re.I)))
    chips=find(r'(?<![A-Z0-9])(?:ICN|IC|MBI|DP|SM|SUM|FM|LS|SS|CNS|CFD|AXS)\d{3,}[A-Z0-9]*')
    pitch=find(r'(?<![A-Z])P\d+(?:\.\d+)?')
    scans=find(r'(?<!\d)\d{1,3}(?:S|扫)(?![A-Z0-9])')
    hubs=find(r'HUB[-_ ]?\d+[A-Z0-9]*')
    resolution=find(r'\d{2,5}[xX×*]\d{2,5}')
    decoders=find(r'(?<!\d)(?:138|595|154|\d{5}|74HC\d+)(?!\d)')
    software=[s for s in ('HDPlayer','HDSet','HDShow','HD2020','HDSign','屏掌控','小灰云','LedArt') if s.lower() in text.lower()]
    for s in (registered.get('software'),):
        if isinstance(s,str) and s and s not in software:software.append(s)
    manufacturer=next((f for f in folders if not re.search(r'20\d\d|新调试|配置|户内|户外|系列|批次',f)),None)
    prefix=re.match(r'^([A-Z]{2,6})[_-]',name)
    return {'chips':chips,'pitches':pitch,'scans':scans,'hubs':hubs,'resolutions':resolution,'decoders':decoders,'software':software,'manufacturer':manufacturer,'manufacturerAbbreviation':prefix[1] if prefix else None,'firmwareVersion':registered.get('firmwareVersion'),'hardwareFamilies':registered.get('hardwareFamilies',[]),'versionNote':registered.get('versionNote'),'applicability':'registered-conditions-only','basis':'literal-filename-and-folders; registered fields retained'}
