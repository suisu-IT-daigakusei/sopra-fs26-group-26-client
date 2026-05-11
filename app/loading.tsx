import GeneralLoadingAnimation from "./components/GeneralLoadingAnimation";

export default function Loading() {
  return (
    <div className="page-transition-loader-overlay page-transition-loader-overlay-static">
      <GeneralLoadingAnimation className="auth-route-loader-frame" />
    </div>
  );
}
