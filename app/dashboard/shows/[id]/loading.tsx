// The tracker's own boundary, tracker-shaped so the real page lands where the
// outline was. See components/PageSkeleton.tsx for why every screen carries one.
import PageSkeleton from '@/components/PageSkeleton'

export default function ShowLoading() {
  return <PageSkeleton shape="show" />
}
