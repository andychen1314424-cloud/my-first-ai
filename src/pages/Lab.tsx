import { PageHead } from '../ui/primitives';
import LabApp from '../modules/lab/LabApp';
import { LabFrame } from '../modules/lab/LabFrame';

export function LabPage() {
  return (
    <div className="page">
      <PageHead title="项目实验台" sub="把想法拆成能完成的任务" />
      <LabFrame><LabApp /></LabFrame>
    </div>
  );
}
