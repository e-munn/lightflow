"""Static audit figures, separate from model fitting and source extraction."""
from pathlib import Path
import argparse, json
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research/label_audit')
COLORS=['#335C81','#E09F3E','#9B5DE5']


def write_figure(fig,path):
    with path.open('xb') as f:fig.savefig(f,format='png',dpi=140,bbox_inches='tight')
    plt.close(fig)


def main():
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--sampling',type=Path,required=True);args=p.parse_args()
    args.out.mkdir(parents=True,exist_ok=False)
    data=json.loads((ROOT/'profile_v1/profile.json').read_text())
    order=sorted(data,key=lambda k:({'train':0,'validation':1,'test':2}[data[k]['split']],k))
    fig,ax=plt.subplots(1,3,figsize=(15,8),sharey=True)
    y=np.arange(len(order))
    ax[0].barh(y,[data[k]['geometry_fraction'] for k in order],color='#D5DDD9',label='Tracked geometry')
    ax[0].barh(y,[min(data[k]['forecast_valid_seconds'])/data[k]['analysis_seconds'] for k in order],height=.5,color='#3C7864',label='Both forecast heads*')
    ax[0].set_yticks(y,[k+' / '+data[k]['split'] for k in order]);ax[0].invert_yaxis()
    ax[0].set_title('Available observations');ax[0].set_xlabel('Fraction of analysis interval');ax[0].legend(loc='lower left',fontsize=9)
    for g,c in zip(['4.8','6.0','7.2'],COLORS):
        ax[1].scatter([data[k]['mapping_gain'][g]['forecast_positive_fraction'][0] for k in order],y,color=c,s=22,label='Mapping gain '+g)
    ax[1].set_title('Rise-positive forecast frequency');ax[1].set_xlabel('Fraction of known forecast labels');ax[1].legend(loc='lower right',fontsize=9)
    ax[2].barh(y,[data[k]['fraction_valid_frames_any_region_over_5pct_clipped'] for k in order],height=.55,color='#B66B53')
    ax[2].set_title('Clipping in measured regions');ax[2].set_xlabel('Fraction of tracked frames with >5%\nclipped pixels in at least one region')
    for a in ax:a.set_xlim(0,1);a.grid(axis='x',alpha=.18);a.set_axisbelow(True)
    fig.suptitle('Lightflow / cross-show label audit\nClipping, coverage and label frequency vary; mapping gain alone does not explain the gap.',fontsize=14,y=1.02)
    fig.text(.02,-.035,'*Lower of the two per-head coverage fractions; not their intersection. No model fitting. Forest is development data. Clipping does not itself prove an event is false.',fontsize=9)
    fig.tight_layout();write_figure(fig,args.out/'cross_show_profile.png')
    comparison=json.loads((args.sampling/'comparison.json').read_text())
    pooled={}
    for mode in ['10hz_phase0','10hz_phase1','10hz_phase2','stored_10hz']:
        pooled[mode]={}
        for name in ['rise','release']:
            rows=[v['versus_30hz'][mode][name] for v in comparison.values()]
            a=sum(r['reference_count'] for r in rows);b=sum(r['candidate_count'] for r in rows);m=sum(r['matched'] for r in rows)
            pooled[mode][name]={'reference_count':a,'candidate_count':b,'matched':m,'agreement_f1':2*m/(a+b) if a+b else None}
    pairs={}
    for pair in ['0_vs_1','0_vs_2','1_vs_2']:
        pairs[pair]={}
        for name in ['rise','release']:
            rows=[v['between_10hz_phases'][pair][name] for v in comparison.values()]
            a=sum(r['reference_count'] for r in rows);b=sum(r['candidate_count'] for r in rows);m=sum(r['matched'] for r in rows)
            pairs[pair][name]={'reference_count':a,'candidate_count':b,'matched':m,'agreement_f1':2*m/(a+b) if a+b else None}
    for key,record in comparison.items():
        d=np.load(args.sampling/(key+'.npz'));t=d['time']-record['start'];energy=d['energy'].mean(1)
        fig,ax=plt.subplots(3,1,figsize=(13,7.5),sharex=True,gridspec_kw={'height_ratios':[3,2,1]})
        ax[0].plot(t,energy,color='#697B77',alpha=.7,lw=.8,label='30 Hz')
        for phase,c in enumerate(COLORS):ax[0].plot(t[phase::3],energy[phase::3],color=c,lw=.8,alpha=.7,label=f'10 Hz phase {phase}')
        ax[0].set_ylim(0,1.05);ax[0].set_ylabel('Observed mapped energy');ax[0].legend(ncol=4,fontsize=9)
        for row,mode in enumerate(['30hz','10hz_phase0','10hz_phase1','10hz_phase2','stored_10hz']):
            for name,marker,color in [('rise','^','#28634E'),('release','v','#B45E4E')]:
                events=np.array(record['event_times'][mode][name])-record['start']
                ax[1].scatter(events,np.full(len(events),row),marker=marker,color=color,s=22)
        ax[1].set_yticks(range(5),['30 Hz','10 Hz phase 0','10 Hz phase 1','10 Hz phase 2','Original 10 Hz']);ax[1].invert_yaxis()
        ax[1].set_title('Event timestamps: green = rise; orange = release. Agreement is not ground-truth precision.',fontsize=10)
        ax[2].plot(t,d['clipped_fraction'].max(1),color='#B66B53',lw=1)
        ax[2].set_ylabel('Max clipped\npixel fraction');ax[2].set_ylim(0,1);ax[2].set_xlabel('Seconds from interval start')
        for a in ax:
            a.set_xlim(0,20);a.grid(alpha=.15)
            for i in np.flatnonzero(~d['valid']):a.axvspan(t[i],t[i]+1/30,color='#D1D1D1',alpha=.45,lw=0)
        fig.suptitle(f'{key} / {record["start"]:.0f}–{record["start"]+20:.0f}s\nGray spans: geometry unavailable. Fixed source, masks and brightness mapping.',fontsize=12)
        fig.tight_layout();write_figure(fig,args.out/(key+'_sampling.png'))
    with (args.out/'summary.json').open('x') as f:json.dump({'versus_30hz':pooled,'between_10hz_phases':pairs,'spans':len(comparison),'seconds':sum(v['duration'] for v in comparison.values()),'interpretation':'Sampling consistency only; 30 Hz is not ground truth.'},f,indent=2,allow_nan=False)
    print(json.dumps(pooled,indent=2),flush=True)


if __name__=='__main__':main()
