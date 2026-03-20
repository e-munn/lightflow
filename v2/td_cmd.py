# Set node thumbnail viewer size to 512
for name in ['render', 'labels', 'comp', 'out']:
    n = op('/project1/' + name)
    if n:
        try:
            n.par.outputresolution = 'custom'
            n.par.outputresolutionw = 512
            n.par.outputresolutionh = 512
        except:
            pass
        try:
            n.viewer = True
            n.par.viewersize = 512
        except:
            pass
print("done - check thumbnail sizes")
