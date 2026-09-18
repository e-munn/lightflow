"""Observed image controls. Values are not calibrated physical light intensity."""
import numpy as np


def observe(pixels):
    pixels=np.asarray(pixels,np.float32).reshape(-1,3)/255
    luma=pixels@np.array([.2126,.7152,.0722],np.float32)
    threshold=max(float(np.quantile(luma,.98)),.025)
    bright=pixels[luma>=threshold]
    top_rgb=bright.mean(0) if len(bright) else np.zeros(3)
    mean_rgb=pixels.mean(0)
    # Fixed mapping: twice as much lit area increases intensity even if peak
    # brightness does not change. Keep raw means for alternative fixed gains.
    intensity=1-np.exp(-6*float(luma.mean()))
    clipped=(pixels.max(1)>=250/255)
    usable=(luma>.025)&~clipped
    color_pixels=pixels[usable];weight=luma[usable]
    if len(color_pixels):
        color=np.average(color_pixels,axis=0,weights=weight)
        chroma=color/max(float(color.sum()),1e-8)
        color_support=float(weight.sum()/max(float(luma.sum()),1e-8))
    else:
        chroma=np.ones(3)/3;color_support=0.
    # Unknown color is neutral for PREVIEW ONLY. Its zero loss weight prevents
    # neutral fallback from being learned as an observed white fixture choice.
    valid=float(color_support>=.35 and len(color_pixels)>=12)
    displayed=chroma/max(float(chroma.max()),1e-8)*intensity
    if not valid:displayed=np.repeat(intensity,3)
    return {'top_rgb':top_rgb.tolist(),'mean_rgb':mean_rgb.tolist(),
            'area_rgb':(1-np.exp(-6*mean_rgb)).tolist(),'intensity':float(intensity),
            'chroma':chroma.tolist(),'color_valid':valid,'color_support':color_support,
            'intensity_color_rgb':displayed.tolist(),'mean_luma':float(luma.mean()),
            'p99_luma':float(np.quantile(luma,.99)),'lit_coverage':float(np.mean(luma>.1)),
            'clipped_pixel_fraction':float(clipped.mean())}
