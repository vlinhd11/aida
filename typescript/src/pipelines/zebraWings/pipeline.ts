import * as tf from '@tensorflow/tfjs';
import englishTokenizer from '../../languages/en/EnglishTokenizer';
import spanishTokenizer from '../../languages/es/SpanishTokenizer';
import * as types from '../../types';
import { EmbeddingsModel } from './embeddings/EmbeddingsModel';
import ClassificationModel from './models/classification';
import NerModel from './models/ner';

function getTokenizer(language: 'en' | 'es') {
    const lang = language ? language.toLowerCase() : language;
    if (lang === 'en') {
        return englishTokenizer;
    } else if (lang === 'es') {
        return spanishTokenizer;
    }
    throw new Error("Invalid config language. Only 'en' and 'es' are supported.");
}

const defaultPipelineDefinition: types.IPipelineDefinition = {
    config: {
        classification: {
            epochs: 5,
            filterSizes: [2, 4, 8],
            lowConfidenceThreshold: 0.3,
            numFilters: 128
        },
        default: {
            batchSize: 120,
            drop: 0.5,
            embeddingDimensions: 300,
            lossThresholdToStopTraining: 0,
            maxNgrams: 20,
            trainingValidationSplit: 0.3
        },
        ner: {
            epochs: 5,
            lowConfidenceThreshold: 0.2,
            maxCharsPerWord: 20,
            numFilters: [256, 128]
        }
    }
};

export class AidaPipeline {
    private pipelineDefinition: types.IPipelineDefinition = defaultPipelineDefinition;
    private datasetParams: types.IDatasetParams;
    private embeddingsModel: EmbeddingsModel;
    private classificationModel: ClassificationModel;
    private nerModel: NerModel;
    private logger: types.IPipelineModelLogger;
    private tokenizer: types.IAidaTokenizer;

    constructor(cfg: {
        dictionary: types.IPretrainedDictionary;
        datasetParams: types.IDatasetParams;
        logger: types.IPipelineModelLogger;
        trainStatsHandler?: types.ITrainStatsHandler;
        pipelineDefinition?: types.IPipelineDefinition;
        pretrainedClassifier?: tf.Model;
        pretrainedNer?: tf.Model;
    }) {
        if (cfg.pipelineDefinition) {
            this.pipelineDefinition = cfg.pipelineDefinition;
        }
        this.datasetParams = cfg.datasetParams;
        this.logger = cfg.logger;
        this.tokenizer = getTokenizer(this.datasetParams.language);
        this.embeddingsModel = new EmbeddingsModel(
            cfg.dictionary,
            this.pipelineDefinition.config.ner.maxCharsPerWord,
            cfg.datasetParams.maxWordsPerSentence,
            this.pipelineDefinition.config.default.maxNgrams,
            this.pipelineDefinition.config.default.embeddingDimensions,
            this.tokenizer
        );
        const classificationCfg = Object.assign({}, this.pipelineDefinition.config.default, this.pipelineDefinition.config.classification);
        let classificationTrainStatsHandler;
        let nerTrainStatsHandler;
        if (cfg.trainStatsHandler) {
            classificationTrainStatsHandler = cfg.trainStatsHandler.classification;
            nerTrainStatsHandler = cfg.trainStatsHandler.ner;
        }
        this.classificationModel = new ClassificationModel(
            classificationCfg,
            this.datasetParams,
            this.embeddingsModel,
            this.logger,
            cfg.pretrainedClassifier,
            classificationTrainStatsHandler
        );
        const nerCfg = Object.assign({}, this.pipelineDefinition.config.default, this.pipelineDefinition.config.ner);
        this.nerModel = new NerModel(
            nerCfg,
            this.datasetParams,
            this.embeddingsModel,
            this.logger,
            cfg.pretrainedNer,
            nerTrainStatsHandler
        );
    }

    public train = async (trainDataset: types.ITrainingParams): Promise<void> => {
        this.logger.log('START TRAINING PIPELINE MODELS!');
        this.logger.log('==================================================================================================');
        await this.classificationModel.train(trainDataset);
        await this.nerModel.train(trainDataset);
        this.logger.log('FINISHED TRAINING PIPELINE MODELS!');
        this.logger.log('==================================================================================================');
    };

    public test = async (testDataset: types.ITestingParams) => {
        this.logger.log('START TESTING PIPELINE MODELS!');
        this.logger.log('==================================================================================================');
        const classificationStats = await this.classificationModel.test(testDataset);
        const nerStats = await this.nerModel.test(testDataset);
        return { classificationStats, nerStats };
    };

    public predict = (sentences: string[]) => {
        const classification = this.classificationModel.predict(sentences);
        const ner = this.nerModel.predict(sentences, classification);
        return { classification, ner };
    };

    public save = async (cfg: { classificationPath: string; nerPath: string }) => {
        this.logger.log('SAVING PIPELINE MODELS!');
        this.logger.log('==================================================================================================');
        const cm = this.classificationModel.tfModel();
        const nm = this.nerModel.tfModel();
        await cm.save(cfg.classificationPath);
        await nm.save(cfg.nerPath);
    };
}
