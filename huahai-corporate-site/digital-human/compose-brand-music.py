"""本任务原创轻音乐；只作配乐，不复刻现有歌曲或使用外部音乐素材。"""
import json, pathlib, wave, os
import numpy as np

root=pathlib.Path(__file__).resolve().parent
build=root/os.environ.get('HUAHAI_VOICE_BUILD','build/promo')
meta=json.loads((build/'voice-manifest.json').read_text())
rate=24000
duration=meta['duration']
music=np.zeros((int(np.ceil(duration*rate)),2),dtype=np.float32)
beat=60/78
chord_seconds=8*beat
chords=[(48,55,60,64),(45,52,57,60),(41,48,53,57),(43,50,55,59),
        (48,55,60,64),(52,59,64,67),(41,48,53,57),(43,50,55,62)]

def put(signal,start,pan=.5):
    begin=int(start*rate)
    if begin>=len(music):return
    end=min(len(music),begin+len(signal))
    n=end-begin
    music[begin:end,0]+=signal[:n]*np.sqrt(1-pan)
    music[begin:end,1]+=signal[:n]*np.sqrt(pan)

for bar,start in enumerate(np.arange(0,duration,chord_seconds)):
    chord=chords[bar%len(chords)]
    t=np.arange(int((chord_seconds+2)*rate))/rate
    env=np.minimum(1,t/1.2)*np.minimum(1,np.maximum(0,chord_seconds+2-t)/2.4)
    for i,note in enumerate(chord):
        freq=440*2**((note-69)/12)
        # 柔和和声层，无高频蜂鸣或生硬节拍。
        pad=(np.sin(2*np.pi*freq*t)+.32*np.sin(2*np.pi*freq*2*t)+.08*np.sin(2*np.pi*freq*3*t))
        pad+=.18*np.sin(2*np.pi*freq*1.0018*t)
        put(pad*env*.042,start,.22+i*.17)
    for step in [0,2,3,5,6]:
        note=chord[[0,1,2,1,3][[0,2,3,5,6].index(step)]]+24
        freq=440*2**((note-69)/12)
        t=np.arange(int(2.9*rate))/rate
        attack=1-np.exp(-t*80)
        pluck=np.sin(2*np.pi*freq*t)*np.exp(-t*2.5)+.25*np.sin(2*np.pi*freq*2*t)*np.exp(-t*5)
        signal=pluck*attack*.025
        put(signal,start+step*beat,.4+.15*np.sin(bar))
        put(signal*.20,start+step*beat+.27,.75)
        put(signal*.10,start+step*beat+.51,.25)
time=np.arange(len(music))/rate
fade=np.minimum(1,time/2.5)*np.minimum(1,np.maximum(0,duration-time)/3.2)
music*=fade[:,None]
peak=float(np.max(np.abs(music)))
if peak>.92:music*=.92/peak
out=build/'brand-music.wav'
with wave.open(str(out),'wb') as wav:
    wav.setnchannels(2);wav.setsampwidth(2);wav.setframerate(rate)
    wav.writeframes((music*32767).astype('<i2').tobytes())
print(f'原创配乐完成 {duration:.2f}s，峰值 {peak:.3f}')
