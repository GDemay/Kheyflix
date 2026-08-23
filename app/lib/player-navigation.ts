import { Route } from "../routing";

export const playbackReturnRoute = (
  currentReturn: Route,
  current: Route,
  next: Route,
) =>
  next.section === "stream" && current.section !== "stream"
    ? current
    : currentReturn;

export class PlaybackRequestGate {
  private generation = 0;

  begin() {
    const generation = ++this.generation;
    return {
      isCurrent: () => generation === this.generation,
      cancel: () => {
        if (generation === this.generation) this.generation++;
      },
    };
  }

  invalidate() {
    this.generation++;
  }
}
