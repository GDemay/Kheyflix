import AccessGate from "../access-gate";
import KheyflixApp from "../kheyflix-app";

export default function CatchAllPage() {
  return (
    <AccessGate>
      <KheyflixApp />
    </AccessGate>
  );
}
