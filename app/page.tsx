import AccessGate from "./access-gate";
import KheyflixApp from "./kheyflix-app";

export default function Page() {
  return (
    <AccessGate>
      <KheyflixApp />
    </AccessGate>
  );
}
