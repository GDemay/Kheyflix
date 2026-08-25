export const showCentralTransportOverlay = ({
  pausedByUser,
  controlsVisible,
  playing,
  finePointer,
}: {
  pausedByUser: boolean;
  controlsVisible: boolean;
  playing: boolean;
  finePointer: boolean;
}) => pausedByUser || (!finePointer && controlsVisible && playing);
