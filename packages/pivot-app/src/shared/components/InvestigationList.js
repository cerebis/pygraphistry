import { Investigation } from './Investigation';
import { Observable } from 'rxjs';
import { Container } from 'reaxtor';
import { app as appClassName,
         frame as graphFrameClassName } from './styles.css';

export class InvestigationList extends Container {
    loadProps(model) {
        return model.getItems(
            () => `['length']`,
            ({json : { length }} ) =>  !length ? [] : [
                 [{ length }, 'length']
            ]
        );
    }

    createChild(props) {
        return new Investigation({
            ...props, field: this.field,
        });
    }

    //loadState(model, props) {
        //return this.loadProps(model)
    //}

    render(model, state, ...investigations) {
        return (
                <div>
                    { investigations }
                </div>
        )
    }
}
