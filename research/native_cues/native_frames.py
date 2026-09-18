"""Decode native frames with matching integer PTS; no frame-rate conversion."""
import queue,re,subprocess,threading
from fractions import Fraction
import numpy as np


def frames(source,start,duration,width=640,height=360):
    command=['ffmpeg','-v','info','-threads','2','-filter_threads','1','-ss',str(start),
        '-t',str(duration+1),'-i',str(source),'-vf',f'trim=end={duration},scale={width}:{height},showinfo',
        '-an','-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgb24','pipe:1']
    process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    metadata=queue.Queue();errors=[]
    def read_metadata():
        time_base=None
        try:
            for raw in iter(process.stderr.readline,b''):
                line=raw.decode(errors='replace')
                if 'showinfo' in line:
                    m=re.search(r'config in time_base:\s*(\d+/\d+)',line)
                    if m:time_base=Fraction(m.group(1))
                    m=re.search(r'\bn:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:',line)
                    if m:
                        assert time_base is not None
                        index,pts=map(int,m.groups())
                        metadata.put((index,pts,time_base))
                elif any(word in line.lower() for word in ['error','invalid','failed']):
                    errors.append(line.strip())
        except Exception as error:errors.append(repr(error))
        finally:metadata.put(None)
    reader=threading.Thread(target=read_metadata,daemon=True);reader.start()
    try:
        index=0;previous=-float('inf')
        while True:
            raw=process.stdout.read(width*height*3)
            if not raw:break
            if len(raw)!=width*height*3:raise RuntimeError('Partial native video frame')
            item=metadata.get(timeout=30)
            if item is None:raise RuntimeError('Video frame has no timestamp metadata: '+repr(errors))
            number,pts,base=item
            assert number==index
            absolute=float(Fraction(str(start))+pts*base)
            assert absolute>previous and start-1e-7<=absolute<start+duration+1e-7
            previous=absolute
            yield absolute,pts,base,np.frombuffer(raw,np.uint8).reshape(height,width,3)
            index+=1
        process.stdout.close();code=process.wait();reader.join(timeout=5)
        assert code==0 and not reader.is_alive(), (code,errors)
        assert not errors, errors
    finally:
        if process.poll() is None:
            # An early consumer stop can leave ffmpeg blocked on a full stdout
            # pipe. Close that read end before requesting graceful termination.
            process.stdout.close()
            process.terminate()
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill();process.wait(timeout=5)
        process.stdout.close();process.stderr.close()
        reader.join(timeout=5)


def source_timestamps(source,start,duration):
    """Independent metadata query; seeking may return preceding keyframe content."""
    import json
    # Decode an extra tail before filtering by presentation time. Stopping packet
    # reading exactly at the requested end can omit final reordered video frames.
    result=json.loads(subprocess.check_output(['ffprobe','-v','error','-read_intervals',f'{start}%{start+duration+1}',
        '-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',str(source)]))
    values=np.array([float(v['best_effort_timestamp_time']) for v in result['frames']])
    return values[(values>=start-1e-7)&(values<start+duration-1e-7)]
